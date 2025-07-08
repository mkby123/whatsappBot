# WhatsApp Bot

This project implements a simple WhatsApp bot in Node.js using [Baileys](https://github.com/WhiskeySockets/Baileys).

## Features

- Anti spam: limits consecutive messages and message bursts.
- Group lock/unlock with `/לנעול` and `/לפתוח`.
- Automatic welcome messages with profile picture and rules.
- Weekly statistics with `/סטטיסטיקה`.
- Group rules with `/חוקים`.
- Reminders with `/לתזכר <minutes> <text>`.
- Predefined tags `/תגיות` for active users and admins.
- Settings command `/הגדרות <feature> <פעיל|כבוי>`.

All texts are in Hebrew and the bot supports multiple groups. Data is stored in `groupData.json` and authentication uses `MultiFileAuthState`.

Run the bot with:

```bash
node index.js
```
