// Shared Firebase bootstrap + cross-page helpers. Every page imports `auth`
// and `db` from here instead of re-initializing its own app instance, so the
// config only lives in one place.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCzs8NliIcPQ76GxzBwDQR26vuMFG07IGU",
  authDomain: "scheduler-609b0.firebaseapp.com",
  projectId: "scheduler-609b0",
  storageBucket: "scheduler-609b0.firebasestorage.app",
  messagingSenderId: "151764758872",
  appId: "1:151764758872:web:4382212aaa6e870395b52d",
  measurementId: "G-MX8DN7YLB2"
};

export const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch (e) { console.warn("Analytics bypassed.", e); }

export const auth = getAuth(app);
export const db = getFirestore(app);

export function cleanUsername(username) {
  return username.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, "");
}

export function usernameToEmail(username) {
  return `${cleanUsername(username)}@scheduler.app`;
}

export function emailToUsername(email) {
  return email ? email.split("@")[0] : "";
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Registers this user in the shared directory on login, so admins can find
// and grant/hide anyone — not just people who've saved a goal or shift.
// Uses merge so it never clobbers an existing "hidden"/"profilePublic" flag.
export async function registerInDirectory(user) {
  try {
    await setDoc(doc(db, "directory", user.uid), {
      username: emailToUsername(user.email),
      updatedAt: Date.now()
    }, { merge: true });
  } catch (error) {
    console.error("Could not register in directory:", error);
  }
}

// Turns a gross pay figure into take-home, using the same "Paycheck
// Deductions" settings schedule.html's tax card saves on the user doc as
// `taxSettings` ({ federalPct, statePct, ficaPct, otherPct, ... }) — plain
// percentages of gross, not a tax-bracket estimate (see the comment above
// schedule.html's recalcTaxSummary for why). Shared here so every page that
// needs "what actually lands in the bank" — the dashboard's net card and
// the expenses page's savings budget — uses the exact same math as the
// Schedule page instead of a second implementation that could drift from
// it. Missing/zero settings fall back to 0% deducted, i.e. net === gross.
export function takeHomePctFromSettings(taxSettings) {
  const s = taxSettings || {};
  const deductedPct = (Number(s.federalPct) || 0) + (Number(s.statePct) || 0) +
    (Number(s.ficaPct) || 0) + (Number(s.otherPct) || 0);
  return Math.max(0, 100 - Math.min(100, deductedPct));
}

export function takeHomeFromGross(gross, taxSettings) {
  return (Number(gross) || 0) * takeHomePctFromSettings(taxSettings) / 100;
}

export function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

export function applyTimeBasedGreeting() {
  const hour = new Date().getHours();
  let text, emoji;
  if (hour >= 5 && hour < 12) { text = "Good morning"; emoji = "☀️"; }
  else if (hour >= 12 && hour < 18) { text = "Good afternoon"; emoji = "🌤️"; }
  else { text = "Good evening"; emoji = "🌙"; }
  const greetingWord = document.getElementById("greetingWord");
  const greetingEmoji = document.getElementById("greetingEmoji");
  if (greetingWord) greetingWord.textContent = text;
  if (greetingEmoji) greetingEmoji.textContent = emoji;
}
