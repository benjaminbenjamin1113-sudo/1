# 💼 Scheduler — Shifts, Money & Life, in One Dashboard

> Track your work schedule, pay, expenses, debts, goals, and investments — with friends, a leaderboard, and now **screenshot-to-schedule import** and a **paycheck tax estimator**. No backend server required: it's a static site backed entirely by Firebase.

![Vanilla JS](https://img.shields.io/badge/JavaScript-ES%20Modules-f7df1e?logo=javascript&logoColor=000)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-ffca28?logo=firebase&logoColor=000)
![No Build Step](https://img.shields.io/badge/build%20step-none-4ade80)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ What's in here

A little personal-finance-and-life suite, split into one page per concern. Every page shares the same look (`shared/base.css`), the same Firebase instance (`shared/firebase.js`), and syncs to the cloud when you're signed in — with a local `localStorage` fallback when you're not.

| Page | What it does |
|---|---|
| 🏠 `index.html` | Dashboard — greeting, net income this month, income vs. expenses chart, and a card for every app below |
| 📅 `schedule.html` | Log shifts per job, see weekly/monthly totals & pay, **import shifts from a screenshot**, edit or delete any shift, and get a **paycheck tax estimate** |
| 💸 `expenses.html` | Log spending, see monthly patterns |
| 💳 `debts.html` | Track balances and pay-down progress |
| 🎯 `goals.html` | Set savings/financial targets and track progress toward them |
| 📈 `investments.html` | Track holdings and cost basis |
| 📊 `market.html` | Live stock & crypto prices with 7-day sparklines |
| 🏆 `leaderboard.html` | Compete with friends on hours, goals, etc. |
| 👥 `friends.html` | Friend requests + notifications |
| 🙍 `profile.html` | Your account/profile settings |
| 🛠️ `admin.html` | Owner/admin/staff-only tools (role-gated, see [Firestore rules](#-firestore-rules)) |

---

## 🆕 New in Schedule: screenshot import, editing, and tax estimates

### 📸 Import a schedule from a screenshot
Got your shifts as a photo of a paper schedule, a screenshot from a work app, or a text message? Upload it on the Schedule page and hit **Scan Image for Shifts**.

- Runs entirely in the browser using **[Tesseract.js](https://github.com/naptha/tesseract.js)** (loaded on demand from a CDN, not called unless you actually scan an image) — no server, no API key, no image ever leaves your device.
- A heuristic parser looks for day names (`Mon`, `Monday`, …) paired with time ranges (`9:00am - 5:00pm`, `9 - 5`, `9:00 – 17:00`, …) and turns each match into a draft shift.
- **Nothing is saved automatically.** You get an editable review table — fix the job name, tweak a time, delete a bad row — before anything touches your schedule. OCR on schedule photos is inherently imperfect (fonts, glare, handwriting), so review-before-commit is the whole point.

### ✎ Edit shifts, not just delete-and-redo
Every logged shift now has an **edit** button next to delete. Editing loads the shift back into the form (day, job, times, rate) and the **Add Shift** button becomes **Update Shift** until you save or cancel.

### 🧾 Paycheck & tax estimate
A new card estimates what a paycheck actually nets out to, based on:
- Your **state** (all 50 states + DC)
- **Filing status** (single / married filing jointly / head of household)
- An **estimated annual pay** figure (auto-suggested from the week you're viewing, or type your own)
- **Pay frequency** (weekly / biweekly / semi-monthly / monthly)

It shows gross vs. net per paycheck and per year, plus the federal, state, and FICA slices, using the shared `shared/tax.js` module (2026 federal brackets, current Social Security wage base, Medicare + Additional Medicare surtax, and a simplified per-state table).

> ⚠️ **This is a planning estimate, not tax advice.** It doesn't know about your W-4 elections, pre-tax deductions (401(k), health insurance), dependents/credits, local/city income tax, or multi-state work. State tax law changes every year — double-check against your state's actual withholding tables or a paycheck calculator before relying on it. See the comment block at the top of `shared/tax.js` for exactly what is and isn't modeled.

---

## 🧱 Tech stack

- **No framework, no build step** — plain HTML/CSS/JS, ES modules loaded straight in the browser.
- **Firebase Auth** (username → synthetic email under the hood) + **Firestore** for cloud sync, friend requests, publishing schedules, and shared market-price caching.
- **Market data:** [CoinGecko](https://www.coingecko.com/en/api) (crypto, no key needed) + [Finnhub](https://finnhub.io/) (stock quotes) + [Twelve Data](https://twelvedata.com/) (stock history) — prices are cached in one shared Firestore doc so N open tabs cost roughly one API call per refresh window, not N calls.
- **OCR:** [Tesseract.js](https://github.com/naptha/tesseract.js), loaded from CDN only when you use the screenshot importer.
- **Hosting:** designed for Firebase Hosting, but it's static files — any static host works.

---

## 📂 Project structure

```
.
├── index.html            # Dashboard
├── schedule.html         # Shifts, hours, pay, screenshot import, tax estimate
├── expenses.html
├── debts.html
├── goals.html
├── investments.html
├── market.html
├── leaderboard.html
├── friends.html
├── profile.html
├── admin.html
├── firestore.rules       # Role-gated security rules
└── shared/
    ├── base.css          # Shared styling for every page except the dashboard
    ├── firebase.js        # Firebase init + cross-page helpers (auth, escaping, toasts…)
    ├── market.js          # Crypto/stock price + history fetching, shared-cache logic
    ├── notifications.js   # Friend requests / notification dropdown
    └── tax.js             # 🆕 Federal + state + FICA paycheck estimator
```

---

## 🚀 Getting started

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com/), enabling:
   - **Authentication** → Email/Password sign-in method
   - **Firestore Database**
   - (optional) **Analytics**
2. **Drop your config** into `shared/firebase.js`:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
     measurementId: "..."
   };
   ```
3. **Deploy the security rules**:
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **(Optional) Add market data keys** in `shared/market.js` if you want live stock quotes/history — crypto prices work with no key via CoinGecko:
   ```js
   export const FINNHUB_API_KEY = "...";
   export const TWELVE_DATA_API_KEY = "...";
   ```
5. **Serve it** — since there's no build step, any static server works:
   ```bash
   npx serve .
   # or
   firebase deploy --only hosting
   ```
6. Open the app, sign up with a username + password, and start logging shifts.

---

## 🔒 Firestore rules

Access is role-gated via a `roles/{uid}` collection (`owner` > `admin` > `staff` > default `member`), with an `isOwner()` check that also recognizes a hardcoded owner email as a bootstrap fallback. A few things worth knowing if you fork this:

- Every user's own document under `users/{uid}` (shifts, pay rates, tax settings, expenses, etc.) is writable only by that user, but **readable by any signed-in user** — friend-schedule viewing relies on this, with `published` flags gating what's actually shown in the UI. Don't treat "can read the raw doc" as "can't get your data" if you fork this for something more sensitive.
- A user's profile is private by default; it becomes visible to others only once `directory/{uid}.profilePublic` is explicitly set to `true`.
- Pay rate is **never** included in what's shown to friends, even when a schedule is published — that's enforced in the schedule page's rendering, not just the rules, so double-check both layers if you change the data model.

Read the full `firestore.rules` for the exact per-collection rules (`directory`, `friendRequests`, `market`, `roles`, etc.).

### A note on the API keys in the client code
Firebase config and the market-data API keys are visible in the page source. That's expected for Firebase (it's not a secret — Firestore rules are what actually protect your data) and fine for Finnhub/Twelve Data here since they're both free-tier, read-only, rate-limited keys with no billing risk. If you fork this and swap in paid or higher-scoped API keys, don't put them directly in client code — proxy them through a small server or Cloud Function instead.

---

## 🗺️ Roadmap ideas

- [ ] Multi-week screenshot import (right now the scanner adds everything to the currently viewed week)
- [ ] Recurring/templated shifts ("same as last week")
- [ ] Export schedule + tax estimate together as one PDF
- [ ] Per-job overtime rules in the pay calculation

## 🤝 Contributing

This is a personal project, but issues and PRs are welcome — especially state-tax-table corrections (tax law changes yearly and a full 50-state bracket table is a lot of surface area to get perfectly current).

## 📄 License

MIT — do whatever you want with it.
