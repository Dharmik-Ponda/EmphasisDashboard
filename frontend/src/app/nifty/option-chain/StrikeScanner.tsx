// Seller-pick logic for the option chain (★ strike + OI wall).
// Recomputed on every chain refresh (every 3 s), so it follows the market.

type Side = "PE" | "CE";

type ScanRow = {
  strike: number;
  side: Side;
  ltp: number;
  delta: number; // absolute
  theta: number; // absolute, points/day
  gamma: number;
  iv: number | null;
  distance: number; // points from spot (OTM, positive)
  oi: number;
  oiChg: number;
  outsideRange: boolean;
  decayPct: number; // theta as % of premium
  premiumPerDelta: number;
  hedgeStrike: number | null;
  spreadCredit: number | null;
  breakeven: number;
  isWall: boolean;
};

const HEDGE_WIDTH = 200;
const STRIKES_PER_SIDE = 8;
const BALANCED_MAX_DELTA = 0.25;
const MIN_DELTA = 0.08;

const toNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const pick = (obj: any, keys: string[]) => {
  if (!obj) return null;
  for (const k of keys) {
    const v = toNum(obj[k]);
    if (v !== null) return v;
  }
  return null;
};
const market = (o: any) => (o && typeof o === "object" ? o.market || o.market_data || o : {});
const greeks = (o: any) => (o && typeof o === "object" ? o.greeks || o.option_greeks || {} : {});
const oiChange = (m: any) => {
  const oi = pick(m, ["oi", "open_interest"]);
  const prev = pick(m, ["prev_oi", "previous_oi"]);
  if (oi !== null && prev !== null) return oi - prev;
  return pick(m, ["oi_change", "change_in_oi"]) ?? 0;
};

function buildSide(chain: any[], side: Side, spot: number, straddle: number): ScanRow[] {
  const key = side === "PE" ? "put" : "call";
  const ltpByStrike = new Map<number, number>();
  for (const row of chain) {
    const k = toNum(row.strike);
    const l = pick(market(row[key]), ["ltp", "last_price", "last_traded_price"]);
    if (k !== null && l !== null) ltpByStrike.set(k, l);
  }

  const otm = chain
    .map((row) => ({ row, strike: toNum(row.strike) }))
    .filter((x): x is { row: any; strike: number } => x.strike !== null)
    .filter((x) => (side === "PE" ? x.strike < spot : x.strike > spot))
    .sort((a, b) => (side === "PE" ? b.strike - a.strike : a.strike - b.strike))
    .slice(0, STRIKES_PER_SIDE);

  const rows: ScanRow[] = [];
  for (const { row, strike } of otm) {
    const m = market(row[key]);
    const g = greeks(row[key]);
    const ltp = pick(m, ["ltp", "last_price", "last_traded_price"]);
    const delta = pick(g, ["delta"]);
    if (ltp === null || ltp <= 0 || delta === null) continue;
    const theta = Math.abs(pick(g, ["theta"]) ?? 0);
    const gamma = pick(g, ["gamma"]) ?? 0;
    const distance = Math.abs(strike - spot);
    const hedgeStrike = side === "PE" ? strike - HEDGE_WIDTH : strike + HEDGE_WIDTH;
    const hedgeLtp = ltpByStrike.get(hedgeStrike);
    rows.push({
      strike,
      side,
      ltp,
      delta: Math.abs(delta),
      theta,
      gamma,
      iv: pick(g, ["iv", "implied_volatility"]),
      distance,
      oi: pick(m, ["oi", "open_interest"]) ?? 0,
      oiChg: oiChange(m),
      outsideRange: distance >= straddle,
      decayPct: (theta / ltp) * 100,
      premiumPerDelta: ltp / Math.max(0.01, Math.abs(delta)),
      hedgeStrike: hedgeLtp !== undefined ? hedgeStrike : null,
      spreadCredit: hedgeLtp !== undefined ? ltp - hedgeLtp : null,
      breakeven: side === "PE" ? strike - ltp : strike + ltp,
      isWall: false
    });
  }
  // OI wall = highest OI on this side among scanned strikes.
  const wall = rows.reduce<ScanRow | null>((b, r) => (!b || r.oi > b.oi ? r : b), null);
  if (wall) wall.isWall = true;
  return rows;
}

// ---------------- Intraday mode ----------------
// Enter in the morning, square off by 3:15 pm. The ★ is chosen for *today*, not for expiry.

export const INTRADAY_DELTA_MIN = 0.25;
export const INTRADAY_DELTA_MAX = 0.4;
export const INTRADAY_STOP_PCT = 35; // exit if premium rises 35% above entry
export const INTRADAY_TARGET_PCT = 50; // book profit when premium falls 50%
const SESSION_MINUTES = 375; // 9:15 – 15:30

export type IntradayDirection = "BULLISH" | "BEARISH" | "NO TRADE" | null;

export type IntradayPhase = "PRE_OPEN" | "OPENING" | "ENTRY" | "LATE" | "SQUARE_OFF" | "CLOSED";

export function getIstMinutes(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function getIntradayPhase(minutes: number): IntradayPhase {
  if (minutes < 9 * 60 + 15) return "PRE_OPEN";
  if (minutes < 10 * 60) return "OPENING"; // watch only
  if (minutes < 13 * 60 + 30) return "ENTRY"; // dashboard entry window
  if (minutes < 15 * 60) return "LATE"; // caution, small size only
  if (minutes < 15 * 60 + 30) return "SQUARE_OFF"; // close everything by 3:15
  return "CLOSED";
}

// 1-SD Nifty move expected for the rest of today's session, from ATM IV.
export function restOfDayMove(spot: number | null, atmIvPct: number | null, minutes: number) {
  if (!spot || !atmIvPct) return null;
  const minutesLeft = Math.max(0, Math.min(SESSION_MINUTES, 15 * 60 + 30 - Math.max(minutes, 9 * 60 + 15)));
  if (minutesLeft <= 0) return 0;
  return spot * (atmIvPct / 100) * Math.sqrt(minutesLeft / SESSION_MINUTES / 252);
}

// Score = today's theta ÷ loss if Nifty moves 1 SD against you (delta + gamma).
// Among strikes with Δ 0.25–0.40, pick the best decay per unit of risk.
function intradayPick(rows: ScanRow[], move: number) {
  const m = Math.max(move, 1);
  let best: ScanRow | null = null;
  let bestScore = -Infinity;
  for (const r of rows) {
    if (r.delta < INTRADAY_DELTA_MIN || r.delta > INTRADAY_DELTA_MAX) continue;
    const risk = r.delta * m + 0.5 * r.gamma * m * m;
    const score = r.theta / Math.max(0.01, risk);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export function getIntradayPicks(
  chain: any[],
  spot: number | null,
  atmIvPct: number | null,
  direction: IntradayDirection,
  minutes: number = getIstMinutes()
) {
  const move = restOfDayMove(spot, atmIvPct, minutes);
  if (!spot || !chain?.length || move === null) {
    return { putPick: null, callPick: null, putWall: null, callWall: null, move };
  }
  const puts = buildSide(chain, "PE", spot, move);
  const calls = buildSide(chain, "CE", spot, move);
  // Bullish → sell puts only; bearish → sell calls only; no clear direction → show both (neutral).
  const wantPut = direction !== "BEARISH";
  const wantCall = direction !== "BULLISH";
  return {
    putPick: wantPut ? intradayPick(puts, move) : null,
    callPick: wantCall ? intradayPick(calls, move) : null,
    putWall: puts.find((r) => r.isWall) ?? null,
    callWall: calls.find((r) => r.isWall) ?? null,
    move
  };
}

// "Balanced" pick = nearest strike that is outside the expected move,
// with delta between MIN_DELTA and BALANCED_MAX_DELTA.
function balancedPick(rows: ScanRow[]) {
  return (
    rows.find((r) => r.outsideRange && r.delta <= BALANCED_MAX_DELTA && r.delta >= MIN_DELTA) ?? null
  );
}

export type SellerPick = ScanRow;

// Used by OptionChainClient to mark ★ (suggested sell strike) and "OI wall" in the chain.
export function getSellerPicks(chain: any[], spot: number | null, straddle: number | null) {
  if (!spot || !straddle || !chain?.length) {
    return { putPick: null, callPick: null, putWall: null, callWall: null };
  }
  const puts = buildSide(chain, "PE", spot, straddle);
  const calls = buildSide(chain, "CE", spot, straddle);
  return {
    putPick: balancedPick(puts),
    callPick: balancedPick(calls),
    putWall: puts.find((r) => r.isWall) ?? null,
    callWall: calls.find((r) => r.isWall) ?? null
  };
}

export const HEDGE_WIDTH_POINTS = HEDGE_WIDTH;
