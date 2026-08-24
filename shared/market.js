// Shared market-price fetching + live-value math, used by any page that
// displays market-linked investment holdings (investments.html, market.html).
// Crypto comes from CoinGecko's public API (no key). Stock quotes come from
// Finnhub's free tier; stock history comes from Twelve Data — Finnhub's free
// tier confirmed 403s on historical candles at every resolution, so quotes
// and history are split across two providers.

// Both keys are public in the page source, same as the Firebase config
// elsewhere in this app — expected for a client-only app, and fine here
// since they only grant read access to public market data. But note that
// unlike the Firebase key, these ARE rate-limited (8 credits/min on Twelve
// Data), and that limit is shared across every user of this app, not
// per-user — see getSharedPrices/getSharedHistory below for how that's
// handled.
export const FINNHUB_API_KEY = "da5r4c1r01qg0j8971qgda5r4c1r01qg0j8971r0";
export const TWELVE_DATA_API_KEY = "726bbc825be8461ab618b393a505b770";

import { db } from "./firebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const CACHE_REF = doc(db, "market", "shared");
const PRICE_CACHE_MS = 60 * 1000;
const HISTORY_CACHE_MS = 20 * 60 * 1000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const CRYPTO_ASSETS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", emoji: "₿", kind: "crypto" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", emoji: "Ξ", kind: "crypto" },
  { id: "solana", symbol: "SOL", name: "Solana", emoji: "◎", kind: "crypto" },
  { id: "ripple", symbol: "XRP", name: "XRP", emoji: "✕", kind: "crypto" }
];

export const STOCK_ASSETS = [
  { symbol: "AAPL", name: "Apple", emoji: "🍎", kind: "stock" },
  { symbol: "MSFT", name: "Microsoft", emoji: "🪟", kind: "stock" },
  { symbol: "NVDA", name: "NVIDIA", emoji: "🎮", kind: "stock" },
  { symbol: "AMZN", name: "Amazon", emoji: "📦", kind: "stock" },
  { symbol: "TSLA", name: "Tesla", emoji: "🚗", kind: "stock" }
];

export const ALL_ASSETS = [...CRYPTO_ASSETS, ...STOCK_ASSETS];

function hasFinnhubKey() {
  return !!FINNHUB_API_KEY && FINNHUB_API_KEY !== "YOUR_FINNHUB_API_KEY";
}

function hasTwelveDataKey() {
  return !!TWELVE_DATA_API_KEY && TWELVE_DATA_API_KEY !== "YOUR_TWELVE_DATA_API_KEY";
}

// One batched call for all tracked coins' current price + 24h % change.
// Returns { SYMBOL: { usd, change24h } }. Throws on failure so callers can
// decide how to surface it (e.g. keep showing last-known values).
export async function fetchCryptoPrices() {
  const ids = CRYPTO_ASSETS.map(c => c.id).join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  );
  if (!res.ok) throw new Error(`Crypto price fetch failed: ${res.status}`);
  const json = await res.json();
  const prices = {};
  CRYPTO_ASSETS.forEach(c => {
    const entry = json[c.id];
    if (entry && typeof entry.usd === "number") {
      prices[c.symbol] = { usd: entry.usd, change24h: entry.usd_24h_change };
    }
  });
  return prices;
}

// Stock quotes, one request per ticker (Finnhub's /quote isn't batchable).
// Skips entirely (returns {}) if no key has been configured yet, rather
// than spamming failed requests.
export async function fetchStockPrices() {
  if (!hasFinnhubKey()) return {};
  const prices = {};
  await Promise.all(STOCK_ASSETS.map(async s => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${s.symbol}&token=${FINNHUB_API_KEY}`
      );
      if (!res.ok) throw new Error(`Stock quote fetch failed: ${res.status}`);
      const json = await res.json();
      if (typeof json.c === "number" && json.c > 0) {
        prices[s.symbol] = { usd: json.c, change24h: json.dp };
      }
    } catch (e) {
      console.error(`Could not fetch quote for ${s.symbol}:`, e);
    }
  }));
  return prices;
}

// Merges crypto + stock prices into one map, tolerant of either source
// failing on its own (e.g. stocks down doesn't blank out crypto).
export async function fetchAllPrices() {
  const [cryptoResult, stockResult] = await Promise.allSettled([
    fetchCryptoPrices(),
    fetchStockPrices()
  ]);
  return {
    ...(cryptoResult.status === "fulfilled" ? cryptoResult.value : {}),
    ...(stockResult.status === "fulfilled" ? stockResult.value : {})
  };
}

// 7 days of hourly price history for one coin, as [[timestamp, price], ...].
export async function fetchCryptoHistory(coinId) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=7`
  );
  if (!res.ok) throw new Error(`Crypto history fetch failed: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.prices) ? json.prices : [];
}

// 7 days of 4-hourly bars for one stock (42 points covers the full week —
// a sparkline doesn't need hourly resolution, and Twelve Data's free tier
// is credit-metered by output size, so fewer points also means each call
// costs less), normalized to the same [[timestamp, price], ...]
// ascending-order shape as fetchCryptoHistory. Twelve Data (not Finnhub —
// see the note at the top of this file) returns newest-first with string
// numbers, so both get fixed up here. Returns [] on any failure so callers
// can render a "chart unavailable" state instead of breaking.
export async function fetchStockHistory(symbol) {
  if (!hasTwelveDataKey()) return [];
  try {
    const res = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=4h&outputsize=42&apikey=${TWELVE_DATA_API_KEY}`
    );
    if (!res.ok) return [];
    const json = await res.json();
    if (json.status === "error" || !Array.isArray(json.values)) return [];
    return json.values
      .map(v => [new Date(v.datetime.replace(" ", "T")).getTime(), parseFloat(v.close)])
      .reverse();
  } catch (e) {
    console.error(`Could not fetch history for ${symbol}:`, e);
    return [];
  }
}

// Live prices, shared across every user of the app via a single Firestore
// doc (market/shared) instead of every open tab hitting the price APIs
// independently. Whoever's local cache check finds the shared doc missing
// or older than PRICE_CACHE_MS re-fetches and writes the result back for
// everyone else to read — so N concurrent users cost roughly one set of
// API calls per cache window, not N sets. Falls back to fetching directly
// (today's per-client behavior) if the Firestore read/write itself fails,
// e.g. before firestore.rules for the market/{docId} path is deployed.
export async function getSharedPrices() {
  try {
    const snap = await getDoc(CACHE_REF);
    const cached = snap.exists() ? snap.data() : null;
    if (cached && cached.prices && Date.now() - (cached.pricesUpdatedAt || 0) < PRICE_CACHE_MS) {
      return cached.prices;
    }
  } catch (e) {
    console.warn("Could not read shared price cache, fetching directly:", e);
  }

  const prices = await fetchAllPrices();
  try {
    await setDoc(CACHE_REF, { prices, pricesUpdatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn("Could not write shared price cache:", e);
  }
  return prices;
}

// Same shared-cache pattern as getSharedPrices, for the 7-day history used
// by the Market page's sparklines.
// Firestore rejects arrays-of-arrays outright ("Nested arrays are not
// supported"), but history is [[timestamp, price], ...] per symbol — so it
// gets flattened to [{t, p}, ...] on the way in and back on the way out.
// Every part of this file outside these two helpers still deals only in
// the [[timestamp, price], ...] shape.
function historyToFirestoreShape(history) {
  const out = {};
  for (const symbol in history) {
    out[symbol] = (history[symbol] || []).map(([t, p]) => ({ t, p }));
  }
  return out;
}

function historyFromFirestoreShape(stored) {
  const out = {};
  for (const symbol in stored) {
    out[symbol] = (stored[symbol] || []).map(entry => [entry.t, entry.p]);
  }
  return out;
}

// onPartial(history), if given, is called once crypto history has loaded
// (fast) and again after each individual stock — so a caller can render
// crypto's chart immediately instead of it waiting behind the 15s-staggered
// stock fetches below it (those exist only to stay under Twelve Data's
// free-tier rate limit — see fetchStockHistory).
export async function getSharedHistory(onPartial) {
  try {
    const snap = await getDoc(CACHE_REF);
    const cached = snap.exists() ? snap.data() : null;
    if (cached && cached.history && Date.now() - (cached.historyUpdatedAt || 0) < HISTORY_CACHE_MS) {
      return historyFromFirestoreShape(cached.history);
    }
  } catch (e) {
    console.warn("Could not read shared history cache, fetching directly:", e);
  }

  const history = {};
  await Promise.all(CRYPTO_ASSETS.map(async a => {
    try {
      history[a.symbol] = await fetchCryptoHistory(a.id);
    } catch (e) {
      console.error(`Could not fetch 7-day history for ${a.symbol}:`, e);
      history[a.symbol] = [];
    }
  }));
  if (onPartial) onPartial(history);

  for (const a of STOCK_ASSETS) {
    history[a.symbol] = await fetchStockHistory(a.symbol);
    if (onPartial) onPartial(history);
    await delay(15 * 1000);
  }

  try {
    await setDoc(CACHE_REF, { history: historyToFirestoreShape(history), historyUpdatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn("Could not write shared history cache:", e);
  }
  return history;
}

// True only for an investment entry that's actually live-linked (a tracked
// asset symbol + a known quantity) — anything else falls back to its own
// stored currentValue.
export function isLiveLinked(inv) {
  if (!inv || !inv.symbol || typeof inv.quantity !== "number") return false;
  return ALL_ASSETS.some(a => a.symbol === inv.symbol);
}

// Live value of a holding given a live prices map, or null if it isn't
// live-linked or its asset's price hasn't loaded yet.
export function liveValueFor(inv, prices) {
  if (!isLiveLinked(inv)) return null;
  const priceInfo = prices[inv.symbol];
  return priceInfo ? inv.quantity * priceInfo.usd : null;
}

// Dollar impact of just the last 24h of market movement on this holding —
// backs out yesterday's price from the live price + 24h % change, so it's
// the asset's own price swing, not the all-time gain/loss vs cost basis.
export function dailyChangeFor(inv, prices) {
  if (!isLiveLinked(inv)) return null;
  const priceInfo = prices[inv.symbol];
  if (!priceInfo || typeof priceInfo.change24h !== "number") return null;
  const currentValue = inv.quantity * priceInfo.usd;
  const prevValue = currentValue / (1 + priceInfo.change24h / 100);
  return currentValue - prevValue;
}
