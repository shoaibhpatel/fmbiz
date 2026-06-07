# 🚀 FOTOMEDIA BUSINESS MANAGER — v1.5 CLOUD
## Online Deployment + Auto Sync Setup Guide

Aapka app ab **bilkul Google Sheets jaisa** kaam karega:
- ✅ Pure static HTML hosting (free, lifelong, GitHub Pages)
- ✅ Data **wahi folder** me save hota hai (`data/db.json` aapke GitHub repo me)
- ✅ Har device pe automatic sync — PC, mobile, kahin bhi browser khol lo
- ✅ Aapki purani **saari real entries safe** hain (already seeded)
- ✅ Offline bhi chalta hai (IndexedDB cache), internet aate hi sync ho jata hai

---

## 📋 PART 1 — Aapko ye karna hai (5 minute, ek baar)

### Step 1: GitHub Account banao (free)
1. Browser me kholo: **https://github.com/signup**
2. Email, password, username daal ke account bana lo
3. Email verify kar lo

### Step 2: Naya Repository banao
1. Login karne ke baad upar **+** icon → **"New repository"** par click karo
2. Repository name: `fmbiz` (kuch bhi naam de sakte ho)
3. **Public** select karo (GitHub Pages free hosting Public repos pe hi free hai)
4. ❌ "Add a README file" ko **mat check karo** (khaali repo chahiye)
5. **"Create repository"** dabao

### Step 3: Saari app files upload karo
1. Naye repo ke page pe **"uploading an existing file"** link milega — click karo
2. Apne computer se ye sab files drag-and-drop karo:
   - `index.html`
   - `app.js`
   - `cloud-sync.js`
   - `style.css`
   - `DP logo.jpg`
   - `data/` folder (puri folder, jisme `db.json` hai — purana data wahi hai)
3. Niche **"Commit changes"** dabao
4. ⏳ 30 second wait — sab files upload ho jayengi

### Step 4: GitHub Pages enable karo (free hosting)
1. Repo me upar **"Settings"** tab par jao
2. Left sidebar me **"Pages"** dhundo, click karo
3. **Source** section me:
   - Source: **"Deploy from a branch"**
   - Branch: **`main`** / Folder: **`/ (root)`**
4. **Save** dabao
5. ⏳ 1-2 minute wait — upar green box me URL aayega:
   `https://AAPKA-USERNAME.github.io/fmbiz/`

🎉 **Ye aapki PUBLIC URL hai!** Kisi bhi device se ye URL kholo, app chalega.

### Step 5: Personal Access Token (PAT) banao
Token = aapke browser ko GitHub me data save karne ki permission.

1. Browser me kholo: **https://github.com/settings/tokens?type=beta**
2. **"Generate new token"** dabao
3. Form bharo:
   - **Token name**: `FmBiz Sync`
   - **Expiration**: 1 year (1 saal baad renew karna)
   - **Repository access**: "Only select repositories" → apna `fmbiz` repo choose karo
   - **Permissions** → **Repository permissions** section me:
     - **Contents** → **Read and write** ✅ (ye sabse zaruri hai)
4. Niche scroll karke **"Generate token"** dabao
5. ⚠️ Token ek lambi string hogi jaise `github_pat_11ABCDEFG...` — **abhi copy kar lo, dobara nahi dikhega!**

### Step 6: App me Cloud Sync configure karo
1. Apna site URL kholo: `https://AAPKA-USERNAME.github.io/fmbiz/`
2. Left sidebar me **"☁️ Cloud Sync"** par click karo
3. Form me bharo:
   - **GitHub Username**: aapka GitHub username
   - **Repository Name**: `fmbiz` (jo bhi naam diya tha)
   - **Branch**: `main`
   - **Data File Path**: `data/db.json` (default rehne do)
   - **Personal Access Token**: jo abhi copy kiya tha, paste karo
4. **"💾 Save & Connect"** dabao
5. ✅ Top right me green pill aayega: **"☁️ Connected"**

🎉 **Bas! Setup complete!**

---

## 📱 PART 2 — Dusre devices pe (mobile / dusra PC)

Bahut simple:
1. Browser me apni site URL kholo: `https://AAPKA-USERNAME.github.io/fmbiz/`
2. **☁️ Cloud Sync** page pe jao
3. Wahi **username, repo, token** daal ke **Save & Connect**
4. Bas! Cloud se latest data aa jayega, har entry sync hogi

**💡 Pro tip**: Phone me URL ko "Add to Home Screen" karo — app jaisa icon ban jayega.

---

## 🔄 Auto-Sync kaise kaam karta hai

| Event | Kya hota hai |
|---|---|
| App khulta hai | Cloud se latest `data/db.json` pull → IndexedDB me load |
| Customer / Invoice add / edit / delete | 3 second baad automatic GitHub pe push |
| Offline ho | IndexedDB local cache me save, online aate hi sync |
| Doosri device pe entry | Refresh karne pe latest data dikhega |

Top right me ek **status pill** hamesha dikhata hai:
- 🟢 **Saved 10:34 AM** — sab synced
- 🟡 **Saving soon…** — 3-second debounce wait
- 🔵 **Syncing…** — abhi push ho raha hai
- 🔴 **Error** — kuch problem (Cloud Sync page khol ke dekho)
- ⚪ **Offline** — sync configured nahi hai

---

## 🛟 Common Problems

### "❌ Token galat / expired hai"
- Token 1 year baad expire ho jata hai → naya banao (Step 5 repeat karo)
- Token sahi copy hua hai check karo (extra space na ho)

### "❌ Repository nahi mili"
- Username / repo name spelling check karo (case-sensitive nahi hai)
- Token me **us specific repo** ka access diya hai? (Step 5.3)

### "Token me write permission nahi hai"
- Token banate samay **Contents = Read and write** select karo (Step 5.3)

### Site khulta nahi `404`
- GitHub Pages enable karna bhul gaye? (Step 4)
- URL me typo? — `username.github.io/repo-name/` format me hona chahiye

### Mobile pe slow
- First time pull me 1-2 second lagega (purana data 845KB hai)
- Uske baad sab fast — bas changes hi push hote hain

---

## 🔒 Security Notes

- **Token sirf is browser me save hota hai** (`localStorage`). Server pe kahin nahi jata.
- Token kisi ko mat dena — wo aapke repo me anything write kar sakta hai
- Public computer pe use ke baad **"Disconnect"** dabana
- Token leak ho jaye? → GitHub Settings → Tokens → **Revoke** kar do, naya bana lo

---

## 📂 Folder Structure (GitHub repo)

```
fmbiz/                          ← aapka repo
├── index.html                  ← App ka entry point
├── app.js                      ← App logic + cloud hooks
├── cloud-sync.js               ← GitHub sync engine  
├── style.css                   ← Styling
├── DP logo.jpg                 ← Default logo
├── data/
│   └── db.json                 ← ⭐ AAPKA POORA DATA YAHAN
└── backup/                     ← (legacy offline backups, optional)
    └── studio-backup-latest.json
```

`data/db.json` literally same folder me hai jaha site files hain. Aap GitHub pe jaa ke wo file kabhi bhi dekh / download / restore kar sakte ho — **manually editing avoid karo, app khud handle karta hai.**

---

## ✨ Tips for Lifelong Use

1. **Token har saal renew karo** — calendar reminder lagao
2. **Multiple devices** pe same token use kar sakte ho — sab sync rahenge
3. **Manual backup**: Cloud Sync page → "⬇️ Pull from Cloud" se latest data download kar sakte ho
4. **Power user**: GitHub par jaa ke aapke `data/db.json` ka pura history dikhta hai — har change ka commit log preserve hai. Galti se kuch delete hua? Pichli commit revert kar do.
5. **Custom domain**: Settings → Pages → Custom domain me apna `fmbiz.example.com` bhi laga sakte ho

---

## 📞 Quick Reference

| Action | Where |
|---|---|
| Cloud config karo | Sidebar → ☁️ Cloud Sync |
| Status dekho | Top right pill, ya Cloud Sync page |
| Manual pull / push | Cloud Sync page ke buttons |
| Disconnect | Cloud Sync page → "🔌 Disconnect" |
| Offline backup (purana way) | Sidebar → 💾 Backup |

**Enjoy your premium cloud studio software! 🎨**
