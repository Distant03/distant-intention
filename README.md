# Distant Intention Study

A phone web app for a citizen-science study of telepathy and morphic resonance, inspired by the work of Rupert Sheldrake.

Players are matched with a partner (usually an anonymous stranger, sometimes someone they know) and try to send or receive one of four pictures. The target is chosen and sealed by the server before each session, so neither player, nor the researchers, can change it afterwards.

## What's here

| File | What it does |
|---|---|
| `index.html` | The page that loads the app |
| `app.js` | All the screens and logic |
| `styles.css` | The night-sky design |
| `config.js` | The Supabase project address and public key |
| `manifest.webmanifest`, `icon*` | Lets people add the app to their phone's home screen |
| `database-1-signup-and-links.sql` | Database script 1: sign-up, questionnaire, invites, links |

## Status

- **Step 2 (this version):** sign-up by email link, the 8-step questionnaire, invite links and codes, confirming links, deleting your account.
- **Next:** matching, the picture test, sealing and results.

## Privacy

The public key in `config.js` is designed to be public. Every table is protected by row-level security, so each player can only ever read their own answers. Dates of birth are stored separately and never shown to anyone.
