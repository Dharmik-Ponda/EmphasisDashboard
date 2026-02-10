import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const UPSTOX_API = "https://api.upstox.com/v2";
const DEFAULT_INSTRUMENT_KEY = "NSE_INDEX|Nifty 50";
const DEFAULT_VIX_KEY = "NSE_INDEX|India VIX";
const FALLBACK_KEYS = [
  "NSE_INDEX|NIFTY 50",
  "NSE_INDEX|NIFTY50"
];
const FALLBACK_VIX_KEYS = [
  "NSE_INDEX|INDIA VIX",
  "NSE_INDEX|INDIAVIX"
];

type OptionChainRow = {
  strike_price?: number;
  strike?: number;
  call_options?:
    | { market_data?: Record<string, unknown>; option_greeks?: Record<string, unknown> }
    | Record<string, unknown>;
  put_options?:
    | { market_data?: Record<string, unknown>; option_greeks?: Record<string, unknown> }
    | Record<string, unknown>;
};

type PriceCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

async function getAccessToken() {
  const latest = await prisma.upstoxSession.findFirst({
    orderBy: { createdAt: "desc" }
  });
  return latest?.accessToken || null;
}

async function upstoxGet(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${UPSTOX_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Api-Version": "2.0",
      Authorization: `Bearer ${token}`
    }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function upstoxLtp(instrumentKeys: string[], token: string) {
  const url = new URL(`${UPSTOX_API}/market-quote/ltp`);
  url.searchParams.set("instrument_key", instrumentKeys.join(","));
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Api-Version": "2.0",
      Authorization: `Bearer ${token}`
    }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function upstoxCandles(
  instrumentKey: string,
  interval: "5minute" | "15minute",
  token: string,
  lookbackDays = 5
) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const url = `${UPSTOX_API}/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${formatDate(to)}/${formatDate(from)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Api-Version": "2.0",
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.data?.candles || [];
}

function normalizeCandles(candles: any[]): PriceCandle[] {
  if (!Array.isArray(candles)) return [];
  return candles
    .map((c) => ({
      time: String(c?.[0] ?? ""),
      open: Number(c?.[1] ?? 0),
      high: Number(c?.[2] ?? 0),
      low: Number(c?.[3] ?? 0),
      close: Number(c?.[4] ?? 0)
    }))
    .filter((c) => c.time && Number.isFinite(c.close));
}

function extractLastFromLtpData(data: Record<string, any>, key: string) {
  const altKey = key.replace("|", ":");
  const byKey = data[key]?.last_price ?? data[altKey]?.last_price ?? null;
  const byToken = Object.values(data).find(
    (v: any) => v?.instrument_token === key || v?.instrument_token === altKey
  ) as any;
  return byKey ?? byToken?.last_price ?? null;
}

function toDateOnly(value: string) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getNearestExpiry(expiries: string[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidates = expiries
    .map((e) => ({ e, d: toDateOnly(e) }))
    .filter((x) => x.d >= today)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  return candidates[0]?.e || expiries.sort()[0];
}

function extractOi(opt: OptionChainRow["call_options"]) {
  if (!opt || typeof opt !== "object") return 0;
  const market =
    "market_data" in opt && opt.market_data && typeof opt.market_data === "object"
      ? opt.market_data
      : opt;
  const oi = (market as any)?.oi ?? (market as any)?.open_interest ?? 0;
  return typeof oi === "number" ? oi : Number(oi) || 0;
}

function computeMaxPain(rows: OptionChainRow[]) {
  const strikes = rows
    .map((r) => (typeof r.strike_price === "number" ? r.strike_price : r.strike))
    .filter((n): n is number => typeof n === "number");
  if (strikes.length === 0) return null;

  const unique = Array.from(new Set(strikes)).sort((a, b) => a - b);
  const callOiMap = new Map<number, number>();
  const putOiMap = new Map<number, number>();

  for (const r of rows) {
    const strike = typeof r.strike_price === "number" ? r.strike_price : r.strike;
    if (typeof strike !== "number") continue;
    callOiMap.set(strike, extractOi(r.call_options));
    putOiMap.set(strike, extractOi(r.put_options));
  }

  let bestStrike = unique[0];
  let bestPain = Number.POSITIVE_INFINITY;

  for (const s of unique) {
    let pain = 0;
    for (const k of unique) {
      const callOi = callOiMap.get(k) || 0;
      const putOi = putOiMap.get(k) || 0;
      if (s > k) {
        pain += callOi * (s - k);
      } else if (s < k) {
        pain += putOi * (k - s);
      }
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = s;
    }
  }

  return bestStrike;
}

export async function GET(req: Request) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "No access token found. Please login via /upstox/login." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const windowParam = Number(searchParams.get("window") || "5");
  const windowSize = Number.isFinite(windowParam) ? Math.max(1, Math.min(50, windowParam)) : 5;
  const includeHistory = searchParams.get("include_history") === "1";
  const instrumentKey =
    searchParams.get("instrument_key") ||
    process.env.UPSTOX_NIFTY_KEY ||
    DEFAULT_INSTRUMENT_KEY;
  let expiryDate = searchParams.get("expiry_date") || "";
  const vixKey =
    searchParams.get("vix_key") ||
    process.env.UPSTOX_VIX_KEY ||
    DEFAULT_VIX_KEY;
  let expiries: string[] = [];

  const contracts = await upstoxGet(
    "/option/contract",
    { instrument_key: instrumentKey },
    accessToken
  );
  if (!contracts.ok) {
    return NextResponse.json(
      { error: "Unable to load option contracts from Upstox", details: contracts.data },
      { status: 502 }
    );
  }
  expiries = Array.from(
    new Set((contracts.data?.data || []).map((c: any) => c?.expiry))
  ).filter(Boolean) as string[];

  // Keep only current and next expiry
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sortedExpiries = expiries
    .map((e) => ({ e, d: toDateOnly(e) }))
    .filter((x) => x.d >= today)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map((x) => x.e);
  expiries = sortedExpiries.slice(0, 6);

  if (!expiryDate) {
    expiryDate = getNearestExpiry(expiries);
  }

  if (!expiryDate) {
    return NextResponse.json(
      { error: "No expiry_date available for instrument_key" },
      { status: 400 }
    );
  }

  const chainRes = await upstoxGet(
    "/option/chain",
    { instrument_key: instrumentKey, expiry_date: expiryDate },
    accessToken
  );

  if (!chainRes.ok) {
    return NextResponse.json(
      { error: "Unable to load option chain from Upstox", details: chainRes.data },
      { status: 502 }
    );
  }

  const rows = (chainRes.data?.data || []) as OptionChainRow[];
  const strikes = Array.from(
    new Set(
      rows
        .map((r) => (typeof r.strike_price === "number" ? r.strike_price : r.strike))
        .filter((n): n is number => typeof n === "number")
    )
  ).sort((a, b) => a - b);

  let step = 50;
  if (strikes.length >= 2) {
    const diffs = [];
    for (let i = 1; i < strikes.length; i += 1) {
      diffs.push(strikes[i] - strikes[i - 1]);
    }
    diffs.sort((a, b) => a - b);
    step = diffs[Math.floor(diffs.length / 2)] || step;
  }

  const ltpRes = await upstoxLtp([instrumentKey, vixKey], accessToken);
  const ltpData = ltpRes.ok
    ? ltpRes.data?.data?.data || ltpRes.data?.data || {}
    : {};
  const underlyingFromLtp = extractLastFromLtpData(ltpData, instrumentKey);
  const vix = extractLastFromLtpData(ltpData, vixKey);
  const underlyingSpot =
    underlyingFromLtp ||
    (chainRes.data?.data && (chainRes.data?.data as any).underlying_spot_price) ||
    chainRes.data?.underlying_spot_price ||
    null;

  const atm = underlyingSpot
    ? strikes.reduce((best: number | null, s) => {
        if (best === null) return s;
        return Math.abs(s - underlyingSpot) < Math.abs(best - underlyingSpot) ? s : best;
      }, null as number | null) ?? strikes[Math.floor(strikes.length / 2)]
    : strikes[Math.floor(strikes.length / 2)];
  const minStrike = atm - windowSize * step;
  const maxStrike = atm + windowSize * step;

  const normalizeOption = (opt: OptionChainRow["call_options"]) => {
    if (!opt || typeof opt !== "object") return { market: {}, greeks: {} };
    const market =
      "market_data" in opt && opt.market_data && typeof opt.market_data === "object"
        ? opt.market_data
        : opt;
    const greeks =
      "option_greeks" in opt && opt.option_greeks && typeof opt.option_greeks === "object"
        ? opt.option_greeks
        : {};
    return { market, greeks };
  };

  const chain = rows
    .map((r) => {
      const strike = typeof r.strike_price === "number" ? r.strike_price : r.strike;
      return {
        strike,
        call: normalizeOption(r.call_options),
        put: normalizeOption(r.put_options)
      };
    })
    .filter((r) => typeof r.strike === "number" && r.strike >= minStrike && r.strike <= maxStrike)
    .sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));

  const maxPain = computeMaxPain(rows);

  let priceHistory5m: PriceCandle[] = [];
  let priceHistory15m: PriceCandle[] = [];
  if (includeHistory) {
    const [candles5m, candles15m] = await Promise.all([
      upstoxCandles(instrumentKey, "5minute", accessToken),
      upstoxCandles(instrumentKey, "15minute", accessToken)
    ]);
    priceHistory5m = normalizeCandles(candles5m || []).slice(-120);
    priceHistory15m = normalizeCandles(candles15m || []).slice(-120);
  }

  return NextResponse.json({
    expiry: expiryDate,
    expiries,
    underlying: underlyingSpot,
    spot_price: underlyingSpot,
    maxPain,
    vix,
    step,
    window: windowSize,
    chain,
    priceHistory: priceHistory5m,
    priceHistory5m,
    priceHistory15m
  });
}
