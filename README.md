# Distant Intention Study

A phone web app for a citizen-science study of telepathy and morphic resonance, inspired by the work of Rupert Sheldrake.

**The Group Telepathy Event, every Sunday.** Every Sunday at 7:30pm (UK time), everyone who has checked in is split at random into senders and receivers. Senders concentrate on one picture for 2 minutes while receivers try to feel it; receivers then sketch for 3 minutes on paper and photograph the sketch at 7:35. The picture is revealed at 7:37. It is chosen at random by the server at the start and sealed with a SHA-256 fingerprint, so nobody can change it afterwards. Leaving the app between 7:30 and 7:35 means that person's part doesn't count.

## What's here

| File | What it does |
|---|---|
| `index.html` | The page that loads the app |
| `app.js` | All the screens and logic |
| `styles.css` | The night-sky design |
| `config.js` | The Supabase project address and public key |
| `manifest.webmanifest`, `icon*` | Lets people add the app to their phone's home screen |
| `database-1-signup-and-links.sql` | Database script 1: sign-up, questionnaire, invites, links |
| `images/test/` | Simple test pictures, used until the event photographs are added |

## Status

- **Step 2:** sign-up by email link, the 8-step questionnaire, invite links and codes, confirming links, deleting your account.
- **Step 3 (this version):** the Group Telepathy Event: countdown, calendar reminder, pledge and check-in, random split, sender and receiver screens, paper sketch photo (or drawing on screen), leaving-the-app rule, reveal and seal check. Admins can start a test event from Settings.
- **Next:** the AI judge, and the pool of event photographs.

## Privacy

The public key in `config.js` is designed to be public. Every table is protected by row-level security, so each player can only ever read their own answers. Dates of birth are stored separately and never shown to anyone.
