// engine/liveApiFetcher.js
// Real NSE/BSE prices via Yahoo Finance (yahoo-finance2 npm package).
// - No API key needed
// - ONE batched call fetches every stock at once
// - If the feed fails (or market is closed) the simulator keeps running on random drift

const MULTIPLIER = Number(process.env.PRICE_MULTIPLIER) || 20;       // amplifies REAL price moves
const EXCHANGE_SUFFIX = process.env.EXCHANGE_SUFFIX || '.NS';        // '.NS' = NSE, '.BO' = BSE
const VOLATILITY = Number(process.env.VOLATILITY) || 1;             // 1 = normal, 2 = twice as wild, 0.5 = calmer
const SIM_SIGMA = 0.005;   // per-tick random push (0.5% at VOLATILITY=1)
const SIM_THETA = 0.005;   // how fast the simulated wander drifts back toward the real-price target
const TARGET_MIN_RATIO = 0.2;   // target never below 20% of start price
const TARGET_MAX_RATIO = 5.0;   // target never above 500% of start price

// Your DB symbol -> real Yahoo ticker, for companies whose ticker changed or differs.
const SYMBOL_MAP = {
  HUL: 'HINDUNILVR',      // Hindustan Unilever
  ZOMATO: 'ETERNAL',      // Zomato was renamed Eternal
  TATAMOTORS: 'TMPV',     // Tata Motors demerged Oct 2025 (cars/JLR = TMPV, trucks = TMCV)
  LTIM: 'LTM',            // LTIMindtree's NSE symbol changed to LTM in Feb 2026
};

const liveTargets = {};   // your symbol -> latest real-world price (₹)
const liveBase = {};      // your symbol -> real price when the contest started (baseline)
const simOffset = {};     // your symbol -> simulated wander around the target (fraction, e.g. +0.03 = +3%)
const shockFactor = {};   // your symbol -> cumulative admin-news factor (1.10 = +10%)

let consecutiveFailures = 0;
let lastSuccessAt = null;
let lastError = null;
let nextAllowedAt = 0;   // back-off: don't hit Yahoo again before this time

// ---------- yahoo-finance2 loader (works with v2, v3 and v4) ----------
let yfPromise = null;
function getYahoo() {
  if (!yfPromise) {
    yfPromise = import('yahoo-finance2')
      .then((mod) => {
        let inst = mod.default;
        if (inst && typeof inst.quote !== 'function' && inst.default) inst = inst.default; // CJS wrapper
        if (typeof inst === 'function') inst = new inst();                                  // v3/v4 class
        try { if (typeof inst.suppressNotices === 'function') inst.suppressNotices(['yahooSurvey']); } catch (_) {}
        return inst;
      })
      .catch((err) => { yfPromise = null; throw err; });
  }
  return yfPromise;
}

// "RELIANCE" -> "RELIANCE.NS"; "HUL" -> "HINDUNILVR.NS"; leaves "TCS.BO" or "^NSEI" untouched
function toYahooSymbol(symbol) {
  const s = String(symbol).trim().toUpperCase();
  if (s.startsWith('^') || /\.(NS|BO)$/.test(s)) return s;
  return (SYMBOL_MAP[s] || s) + EXCHANGE_SUFFIX;
}

// ---------- fetch real prices for ALL symbols in a single call ----------
async function refreshTargets(symbols) {
  if (!symbols || symbols.length === 0) return;
  if (Date.now() < nextAllowedAt) return;   // still cooling down after a failure

  const yahooToOurs = new Map(symbols.map((s) => [toYahooSymbol(s), s]));

  try {
    const yf = await getYahoo();
    // validateResult:false -> don't throw if Yahoo adds/changes fields for one stock
    const quotes = await yf.quote(
      [...yahooToOurs.keys()],
      { fields: ['symbol', 'regularMarketPrice'] },
      { validateResult: false }
    );

    const gotSymbols = new Set();
    for (const q of quotes) {
      const ours = yahooToOurs.get(String(q.symbol).toUpperCase());
      const price = Number(q.regularMarketPrice);
      if (!ours || !Number.isFinite(price) || price <= 0) continue;

      liveTargets[ours] = price;
      if (liveBase[ours] === undefined) liveBase[ours] = price;
      gotSymbols.add(ours);
    }

    const missing = symbols.filter((s) => !gotSymbols.has(s));
    if (missing.length) {
      console.warn(`[FEED] No price returned for: ${missing.join(', ')} -> check the ticker (see SYMBOL_MAP)`);
    }
    if (gotSymbols.size === 0) throw new Error('Yahoo returned no usable prices');

    consecutiveFailures = 0;
    nextAllowedAt = 0;
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    console.log(`✅ [FEED] Updated ${gotSymbols.size}/${symbols.length} live prices`);
  } catch (err) {
    consecutiveFailures++;
    const msg = `${err.name || 'Error'}: ${err.message}`;
    lastError = msg;
    let hint = '';
    const rateLimited = /Too Many Requests|429/.test(msg);
    if (/Cannot find package|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(msg)) {
      hint = ' -> run: npm install yahoo-finance2 (in the folder that has package.json)';
    } else if (rateLimited) {
      hint = ' -> Yahoo is rate-limiting this IP/version; backing off. Upgrade: npm.cmd install yahoo-finance2@latest (Node 22+)';
    } else if (/Unsupported Node|ERR_REQUIRE_ESM|is not a constructor/.test(msg)) {
      hint = ' -> Node version problem: run "node -v"';
    }
    // exponential back-off: 60s, 120s, 240s ... capped at 5 min (rate limits need a longer pause)
    const base = rateLimited ? 60000 : 15000;
    const wait = Math.min(300000, base * Math.pow(2, consecutiveFailures - 1));
    nextAllowedAt = Date.now() + wait;
    console.warn(`[FEED WARNING] Live fetch failed (${msg})${hint}. Using simulation. Retrying in ${Math.round(wait / 1000)}s. Failures in a row: ${consecutiveFailures}`);
  }
}

// Call when Admin opens trading (or syncs prices) so the contest starts from "now"
function resetBaselines(clearShocks = false) {
  for (const s of Object.keys(liveTargets)) liveBase[s] = liveTargets[s];
  if (clearShocks) {
    for (const s of Object.keys(shockFactor)) delete shockFactor[s];
    for (const s of Object.keys(simOffset)) delete simOffset[s];
  }
  console.log('[FEED] Baselines reset to current real prices');
}

// Admin news: shockPct = +10 or -7.5 (percent)
function applyShock(symbol, shockPct) {
  const f = 1 + Number(shockPct) / 100;
  if (!Number.isFinite(f) || f <= 0) return;
  shockFactor[symbol] = (shockFactor[symbol] || 1) * f;
}

// Real move since contest start, amplified by MULTIPLIER, applied to the start price
function getTargetPrice(symbol, p0) {
  let target = p0;
  const live = liveTargets[symbol];
  const base = liveBase[symbol];
  if (live && base) {
    target = p0 * (1 + (MULTIPLIER * (live - base)) / base);
  }
  target *= shockFactor[symbol] || 1;
  return Math.min(Math.max(target, p0 * TARGET_MIN_RATIO), p0 * TARGET_MAX_RATIO);
}

function gauss() {                       // standard normal random number
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Called by the 2-second ticker for each stock
function getLivePrice(symbol, currentPrice, p0) {
  // 1) simulated wander: a slow, mean-reverting random walk so prices trend up/down visibly
  let off = simOffset[symbol] || 0;
  off += -SIM_THETA * off + SIM_SIGMA * VOLATILITY * gauss();
  off = Math.max(-0.25, Math.min(0.25, off));
  simOffset[symbol] = off;

  // 2) target = real-market move (amplified) + admin news + the simulated wander
  const target = getTargetPrice(symbol, p0) * (1 + off);

  // 3) glide toward the target, plus a little tick-to-tick jitter
  const pull = (target - currentPrice) * 0.3;
  const jitter = (Math.random() - 0.5) * 0.002 * currentPrice * VOLATILITY;

  let newPrice = currentPrice + pull + jitter;

  const maxSwing = currentPrice * 0.15;                                 // per-tick safety cap
  if (newPrice > currentPrice + maxSwing) newPrice = currentPrice + maxSwing;
  if (newPrice < currentPrice - maxSwing) newPrice = currentPrice - maxSwing;

  return Math.max(5.0, Number(newPrice.toFixed(2)));
}

function getFeedStatus() {
  return {
    multiplier: MULTIPLIER,
    volatility: VOLATILITY,
    exchange_suffix: EXCHANGE_SUFFIX,
    last_success_at: lastSuccessAt,
    consecutive_failures: consecutiveFailures,
    last_error: lastError,
    symbols_with_live_price: Object.keys(liveTargets).length,
    live_prices: liveTargets
  };
}

module.exports = { getLivePrice, refreshTargets, resetBaselines, applyShock, getFeedStatus, toYahooSymbol };