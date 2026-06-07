==============================================
 FOTOMEDIA BUSINESS MANAGER — v1.5 CLOUD
 Static HTML + GitHub-backed Auto-Sync
==============================================

🎉 WHAT'S NEW IN v1.5 (CLOUD EDITION)
--------------------------------------
1. ☁️ GITHUB CLOUD SYNC — works like Google Sheets
   • Pure static HTML hosting (GitHub Pages, free, lifelong)
   • Data file `data/db.json` lives in the SAME repo as the website
   • Auto-pull on app open → always latest data on any device
   • Auto-push on every change (3-second debounce) → no manual saves
   • Cross-device sync: PC, mobile, tablet — open the URL, that's it
   • Offline-tolerant: IndexedDB cache, syncs when online returns

2. 🟢 LIVE SYNC STATUS PILL (top right)
   • 🟢 Saved 10:34 AM — everything in cloud
   • 🟡 Saving soon… — change pending, will push in 3s
   • 🔵 Syncing… — push in progress
   • 🔴 Error — click to see Cloud Sync page
   • ⚪ Offline — sync not configured yet

3. 📦 PURANI ENTRIES SEEDED
   Your existing offline data (Sarang Production, Kodak Clicks,
   2 invoices, 1 payment, 1 receipt) is pre-loaded in `data/db.json`.
   First app open will auto-import these into IndexedDB.

4. 🔄 ALL v1.4 FEATURES PRESERVED
   Quick-add modals, serial doc numbers, WhatsApp/Gmail icons,
   PDF auto-attach, backup verify, recurring invoices — all still here.

⚡ QUICK START
---------------
Open SETUP_GUIDE.md for the full 5-minute setup walkthrough.

Short version:
  1. Create GitHub account → new public repo (e.g. "fmbiz")
  2. Upload ALL files from this folder to the repo
  3. Settings → Pages → Deploy from main branch → Save
  4. Generate a Personal Access Token (fine-grained, Contents: R/W)
  5. Open your https://USERNAME.github.io/fmbiz/ URL
  6. Sidebar → ☁️ Cloud Sync → fill username/repo/token → Save & Connect
  7. Done! Now use the same URL on any device, sync is automatic.

📂 FILES IN THIS FOLDER
------------------------
  index.html               — App entry (open this in browser locally too)
  app.js                   — Application logic + cloud hooks
  cloud-sync.js            — GitHub REST sync engine
  style.css                — Stylesheet (incl. cloud pill styles)
  DP logo.jpg              — Default brand logo
  data/db.json             — ⭐ Your live database (synced from cloud)
  backup/                  — Legacy offline backup (optional, can delete)
  SETUP_GUIDE.md           — Full step-by-step deployment guide
  README.txt               — This file

🔐 SECURITY
-----------
• Personal Access Token is stored ONLY in your browser's localStorage
• Never share the token. If leaked, revoke it on GitHub immediately.
• Token expires every 1 year — renew before then.

💾 BACKUP STRATEGIES (multiple layers, you can't lose data)
------------------------------------------------------------
1. PRIMARY: data/db.json in your GitHub repo (this is your "live" DB)
2. GitHub keeps FULL commit history of every change — you can revert
   to any previous state via the repo's "History" view.
3. Manual export: 💾 Backup page still works (downloads JSON locally)
4. Auto-backup: Original v1.4 5-minute folder backup still runs if
   you click "Choose App Folder" (offline use)

🆘 HELP & TROUBLESHOOTING
--------------------------
See SETUP_GUIDE.md → "Common Problems" section.

Enjoy your premium cloud studio software! 🎨
