const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const P = require('pino')
const schedule = require('node-schedule')
const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, 'groupData.json')
let groupData = {}
if (fs.existsSync(DATA_FILE)) {
    groupData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(groupData, null, 2))
}

function getGroupConfig(id) {
    if (!groupData[id]) {
        groupData[id] = {
            features: {
                antiSpam: true,
                welcome: true,
                stats: true,
                reminders: true,
                tags: true
            },
            rules: 'ברוכים הבאים!',
            lock: false,
            lockHours: null,
            messageCounts: {},
            warnings: {},
            active: {}
        }
        saveData()
    }
    return groupData[id]
}

async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const { version } = await fetchLatestBaileysVersion()
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: P({ level: 'silent' })
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message || msg.key.fromMe) return
        if (!msg.key.remoteJid.endsWith('@g.us')) return
        const groupId = msg.key.remoteJid
        const group = getGroupConfig(groupId)
        const sender = msg.key.participant
        const from = sender.split('@')[0]

        // update stats
        if (group.features.stats) {
            group.messageCounts[from] = (group.messageCounts[from] || 0) + 1
            saveData()
        }

        // update active users
        group.active[from] = Date.now()

        // anti spam
        if (group.features.antiSpam) {
            const warn = group.warnings[from] || { streak: 0, lastTimes: [] }
            warn.streak = warn.lastSender === from ? warn.streak + 1 : 1
            warn.lastSender = from
            warn.lastTimes.push(Date.now())
            warn.lastTimes = warn.lastTimes.filter(t => Date.now() - t < 5000)
            if (warn.streak > 5 || warn.lastTimes.length > 10) {
                sock.sendMessage(groupId, { text: `@${from} נשלחו יותר מדי הודעות, השתקה ל-10 דקות`, mentions: [sender] })
                await sock.groupParticipantsUpdate(groupId, [sender], 'demote')
                await sock.groupParticipantsUpdate(groupId, [sender], 'restrict')
                schedule.scheduleJob(Date.now() + 10 * 60 * 1000, () => {
                    sock.groupParticipantsUpdate(groupId, [sender], 'unrestrict')
                })
                warn.streak = 0
                warn.lastTimes = []
            }
            group.warnings[from] = warn
        }

        const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || ''

        if (messageContent.startsWith('/')) {
            await handleCommand(sock, msg, messageContent.trim(), group)
        }
    })

    sock.ev.on('group-participants.update', async (update) => {
        const groupId = update.id
        const group = getGroupConfig(groupId)
        if (!group.features.welcome) return
        if (update.action === 'add') {
            for (const user of update.participants) {
                let pp
                try { pp = await sock.profilePictureUrl(user, 'image') } catch { }
                const name = (await sock.onWhatsApp(user))[0]?.notify || 'חבר חדש'
                let text = `ברוך הבא ${name}!\n\n${group.rules}`
                sock.sendMessage(groupId, { image: { url: pp }, caption: text })
            }
        }
    })

    return sock
}

async function handleCommand(sock, msg, command, group) {
    const groupId = msg.key.remoteJid
    const sender = msg.key.participant
    const from = sender.split('@')[0]
    const meta = await sock.groupMetadata(groupId)
    const admins = meta.participants.filter(p => p.admin).map(p => p.id)
    const isAdmin = admins.includes(sender)

    if (command === '/לנעול' && isAdmin) {
        await sock.groupSettingUpdate(groupId, 'announcement')
        group.lock = true
        saveData()
        return sock.sendMessage(groupId, { text: 'הקבוצה ננעלה' })
    }
    if (command === '/לפתוח' && isAdmin) {
        await sock.groupSettingUpdate(groupId, 'not_announcement')
        group.lock = false
        saveData()
        return sock.sendMessage(groupId, { text: 'הקבוצה נפתחה' })
    }
    if (command === '/סטטיסטיקה') {
        let text = 'מספר הודעות השבוע:\n'
        for (const [u, c] of Object.entries(group.messageCounts)) {
            text += `@${u} - ${c}\n`
        }
        return sock.sendMessage(groupId, { text, mentions: admins })
    }
    if (command === '/חוקים') {
        return sock.sendMessage(groupId, { text: group.rules })
    }
    if (command.startsWith('/לתזכר')) {
        const parts = command.split(' ')
        const min = parseInt(parts[1])
        const text = parts.slice(2).join(' ')
        if (isNaN(min) || !text) return
        sock.sendMessage(groupId, { text: `התזכורת תישלח בעוד ${min} דקות` })
        schedule.scheduleJob(Date.now() + min * 60 * 1000, () => {
            sock.sendMessage(groupId, { text })
        })
    }
    if (command === '/תגיות') {
        const active = Object.keys(group.active).filter(u => Date.now() - group.active[u] < 24 * 60 * 60 * 1000)
        const mentions = [...admins, ...active]
        const text = `פעילים: ${active.map(u => '@' + u).join(' ')}\nמנהלים: ${admins.map(u => '@' + u.split('@')[0]).join(' ')}`
        sock.sendMessage(groupId, { text, mentions })
    }
    if (command.startsWith('/הגדרות') && isAdmin) {
        const parts = command.split(' ')
        const feature = parts[1]
        const state = parts[2] === 'פעיל'
        if (feature && feature in group.features) {
            group.features[feature] = state
            saveData()
            sock.sendMessage(groupId, { text: `הפיצ'ר ${feature} עודכן ל-${state ? 'פעיל' : 'כבוי'}` })
        }
    }
}

startSock()
