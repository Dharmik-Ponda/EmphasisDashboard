import { NextResponse } from "next/server";

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
  call_options?: { market_data?: Record<string, unknown> } | Record<string, unknown>;
  put_options?: { market_data?: Record<string, unknown> } | Record<string, unknown>;
};

let lastFiveRecords: any[] = [];
const DEDUPE_FIELDS = [
  "PE Total OI Change",
  "CE Total OI Change",
  "PE OI Change (±2)",
  "CE OI Change (±2)",
  "ALL Change OI PCR",
  "Current Change OI PCR",
  "Current All OI PCR"
] as const;

async function getAccessToken() {
  const { prisma } = await import("@/lib/prisma");
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

async function upstoxQuote(instrumentKeys: string[], token: string) {
  const url = new URL(`${UPSTOX_API}/market-quote/quotes`);
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

async function resolveLtpAndVwap(
  primary: string,
  fallbacks: string[],
  token: string
) {
  const keys = [primary, ...fallbacks];
  for (const k of keys) {
    const ltpRes = await upstoxLtp([k], token);
    const ltpData = ltpRes.ok
      ? ltpRes.data?.data?.data || ltpRes.data?.data || {}
      : {};
    const altKey = k.replace("|", ":");
    const byKey =
      ltpData[k]?.last_price ??
      ltpData[altKey]?.last_price ??
      null;
    const byToken = Object.values(ltpData).find(
      (v: any) => v?.instrument_token === k || v?.instrument_token === altKey
    ) as any;
    const last =
      byKey ??
      byToken?.last_price ??
      (Object.values(ltpData) as any)[0]?.last_price ??
      null;

    const quoteRes = await upstoxQuote([k], token);
    const quoteData = quoteRes.ok ? quoteRes.data?.data || {} : {};
    const vwap =
      quoteData[k]?.average_price ??
      quoteData[altKey]?.average_price ??
      (Object.values(quoteData) as any)[0]?.average_price ??
      null;

    if (last !== null || vwap !== null) {
      return { key: k, last, vwap };
    }
  }
  return { key: primary, last: null, vwap: null };
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

function getNearestExpiry(expiries: string[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidates = expiries
    .map((e) => ({ e, d: toDateOnly(e) }))
    .filter((x) => x.d >= today)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  return candidates[0]?.e || expiries.sort()[0];
}

const toNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
};

const getMarket = (opt: any) => {
  if (!opt || typeof opt !== "object") return {};
  return opt.market || opt.market_data || opt;
};

const oiChange = (market: any) => {
  const oi = toNumber(market?.oi ?? market?.open_interest);
  const prevOi = toNumber(market?.prev_oi ?? market?.previous_oi);
  if (oi || prevOi) return oi - prevOi;
  return toNumber(market?.oi_change ?? market?.change_in_oi ?? 0);
};

const getStrike = (row: OptionChainRow) =>
  typeof row.strike_price === "number" ? row.strike_price : row.strike || 0;

function sentiment(allPcr: number) {
  if (allPcr > 1.25) return { label: "BULLISH MARKET", tone: "bullish" };
  if (allPcr < 0.75) return { label: "BEARISH MARKET", tone: "bearish" };
  return { label: "NEUTRAL / RANGEBOUND", tone: "neutral" };
}

function trendStrength(changePcr: number) {
  if (changePcr >= 1.3) return "STRONG BUYING SUPPORT";
  if (changePcr >= 1.1) return "MILD BUYING FLOW";
  if (changePcr >= 0.9) return "BALANCED / SIDEWAYS";
  return "STRONG SELLING PRESSURE";
}

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2).replace(/\.00$/, "")} L`;
  return `${sign}${Math.round(abs).toLocaleString("en-IN")}`;
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
  const instrumentKey =
    searchParams.get("instrument_key") ||
    process.env.UPSTOX_NIFTY_KEY ||
    DEFAULT_INSTRUMENT_KEY;
  let expiryDate = searchParams.get("expiry_date") || "";
  const vixKey =
    searchParams.get("vix_key") ||
    process.env.UPSTOX_VIX_KEY ||
    DEFAULT_VIX_KEY;

  if (!expiryDate) {
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
    const expiries = Array.from(
      new Set((contracts.data?.data || []).map((c: any) => c?.expiry))
    ).filter(Boolean) as string[];
    expiryDate = getNearestExpiry(expiries);
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
  const sorted = [...rows].sort((a, b) => getStrike(a) - getStrike(b));

  // Determine ATM using underlying LTP, then select ATM ± 2 strikes
  const underlyingRes = await resolveLtpAndVwap(
    instrumentKey,
    FALLBACK_KEYS,
    accessToken
  );
  const ltpRes = await upstoxLtp([vixKey], accessToken);
  const ltpData = ltpRes.ok
    ? ltpRes.data?.data?.data || ltpRes.data?.data || {}
    : {};
  const underlying = underlyingRes.last;
  const vix = extractLastFromLtpData(ltpData, vixKey);
  const vwap = underlyingRes.vwap;
  const vwapSignal =
    underlying && vwap
      ? underlying > vwap
        ? "Above VWAP"
        : underlying < vwap
          ? "Below VWAP"
          : "At VWAP"
      : "-";

  const strikes = sorted.map(getStrike).filter((n) => typeof n === "number");
  let step = 50;
  if (strikes.length > 1) {
    const diffs = [];
    for (let i = 1; i < strikes.length; i += 1) {
      diffs.push(Math.abs(strikes[i] - strikes[i - 1]));
    }
    diffs.sort((a, b) => a - b);
    step = diffs[Math.floor(diffs.length / 2)] || step;
  }
  const atm = underlying
    ? Math.round((underlying as number) / step) * step
    : strikes[Math.floor(strikes.length / 2)] || 0;
  const atmIndex = sorted.findIndex((r) => getStrike(r) === atm);
  const safeIndex = atmIndex >= 0 ? atmIndex : Math.floor(sorted.length / 2);
  const allWindow = sorted.slice(
    Math.max(0, safeIndex - 5),
    Math.min(sorted.length, safeIndex + 6)
  ); // ATM ±5
  const focus = sorted.slice(
    Math.max(0, safeIndex - 2),
    Math.min(sorted.length, safeIndex + 3)
  ); // ATM ±2

  let pe_all_oi_change_total = 0; // puts (buyers)
  let pe_oi_lakh_total = 0;
  let ce_all_oi_change_total = 0; // calls (sellers)
  let ce_oi_lakh_total = 0;
  let pe_oi_change_total = 0;
  let ce_oi_change_total = 0;
  let buyers_volume_count_total = 0;
  let sellers_volume_count_total = 0;

  let maxPeOiChange = -Infinity;
  let maxPeStrike = null as number | null;
  let minPeOiChange = Infinity;
  let minPeStrike = null as number | null;
  let maxCeOiChange = -Infinity;
  let maxCeStrike = null as number | null;
  let minCeOiChange = Infinity;
  let minCeStrike = null as number | null;

  for (const row of sorted) {
    const putMarket = getMarket(row.put_options);
    const callMarket = getMarket(row.call_options);

    const putOi = toNumber(putMarket?.oi ?? putMarket?.open_interest);
    const callOi = toNumber(callMarket?.oi ?? callMarket?.open_interest);

    const putOiChg = oiChange(putMarket);
    const callOiChg = oiChange(callMarket);

    pe_all_oi_change_total += putOiChg;
    ce_all_oi_change_total += callOiChg;

    pe_oi_lakh_total += putOi;
    ce_oi_lakh_total += callOi;

    const strike = getStrike(row);
    if (putOiChg > maxPeOiChange) {
      maxPeOiChange = putOiChg;
      maxPeStrike = strike;
    }
    if (putOiChg < minPeOiChange) {
      minPeOiChange = putOiChg;
      minPeStrike = strike;
    }
    if (callOiChg > maxCeOiChange) {
      maxCeOiChange = callOiChg;
      maxCeStrike = strike;
    }
    if (callOiChg < minCeOiChange) {
      minCeOiChange = callOiChg;
      minCeStrike = strike;
    }
  }

  for (const row of focus) {
    const putMarket = getMarket(row.put_options);
    const callMarket = getMarket(row.call_options);

    const putOiChg = oiChange(putMarket);
    const callOiChg = oiChange(callMarket);

    const putOi = toNumber(putMarket?.oi ?? putMarket?.open_interest);
    const callOi = toNumber(callMarket?.oi ?? callMarket?.open_interest);

    const putVol = toNumber(putMarket?.volume ?? putMarket?.volume_traded);
    const callVol = toNumber(callMarket?.volume ?? callMarket?.volume_traded);

    pe_oi_change_total += putOiChg;
    ce_oi_change_total += callOiChg;
    pe_oi_lakh_total += putOi;
    ce_oi_lakh_total += callOi;
    sellers_volume_count_total += putVol;
    buyers_volume_count_total += callVol;
  }

  // PCR should be PUT (PE) / CALL (CE)
  const all_pcr = pe_all_oi_change_total / (ce_all_oi_change_total || 1);
  const current_change_pcr = pe_oi_change_total / (ce_oi_change_total || 1);
  const current_all_pcr = pe_oi_lakh_total / (ce_oi_lakh_total || 1);

  let pcrSignal = "Neutral zone";
  let pcrTone: "bullish" | "bearish" | "neutral" = "neutral";
  if (all_pcr > 1.25) {
    pcrSignal = "BULLISH MARKET";
    pcrTone = "bullish";
  } else if (all_pcr < 0.75) {
    pcrSignal = "BEARISH MARKET";
    pcrTone = "bearish";
  }

  let buildUpSignal = "Neutral";
  let buildUpStrike: number | null = null;
  if (all_pcr > 1.25) {
    buildUpSignal = "Bullish build-up";
    buildUpStrike = maxPeStrike;
  } else if (all_pcr < 0.75) {
    buildUpSignal = "Bearish build-up";
    buildUpStrike = maxCeStrike;
  } else {
    buildUpSignal = "Neutral";
  }

  const record = {
    Time: new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: true
    }),
    "PE Total OI Change": formatVolume(pe_all_oi_change_total),
    "CE Total OI Change": formatVolume(ce_all_oi_change_total),
    "PE OI Change (±2)": formatVolume(pe_oi_change_total),
    "CE OI Change (±2)": formatVolume(ce_oi_change_total),
    "ALL Change OI PCR": +all_pcr.toFixed(2),
    "Current Change OI PCR": +current_change_pcr.toFixed(2),
    "Current All OI PCR": +current_all_pcr.toFixed(2)
  };

  const isDuplicate = lastFiveRecords.some((existing) =>
    DEDUPE_FIELDS.every((field) => existing?.[field] === record[field])
  );
  if (!isDuplicate) {
    lastFiveRecords.push(record);
    if (lastFiveRecords.length > 5) lastFiveRecords.shift();
  }

  return NextResponse.json({
    records: lastFiveRecords,
    latest: record,
    expiry: expiryDate,
    underlying,
    vix,
    vwap,
    vwapSignal,
    peBuildUp: { strike: maxPeStrike, oiChange: maxPeOiChange },
    peReduction: { strike: minPeStrike, oiChange: minPeOiChange },
    ceBuildUp: { strike: maxCeStrike, oiChange: maxCeOiChange },
    ceReduction: { strike: minCeStrike, oiChange: minCeOiChange },
    sentiment: sentiment(record["ALL Change OI PCR"]),
    trend: trendStrength(record["Current Change OI PCR"]),
    signals: {
      pcrSignal,
      pcrTone,
      buildUpSignal,
      buildUpStrike
    }
  });
}
