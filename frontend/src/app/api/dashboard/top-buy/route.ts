import { NextResponse } from "next/server";
import {
  getAccessToken,
  fetchInstruments,
  getOhlcMap,
  parseDaily,
  fetchHistoricalCandles,
  computeSma,
  formatRows
} from "../_shared";

const HIST_LOOKBACK_DAYS = 80;
const MAX_CANDIDATES = 150;

export async function GET() {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "No access token found. Please login via /upstox/login." }, { status: 401 });
  }

  const instruments = await fetchInstruments();
  const equities = instruments.filter(
    (i: any) => i.segment === "NSE_EQ" && i.instrument_type === "EQ" && i.instrument_key
  );

  const keys = equities.map((i: any) => i.instrument_key as string);
  const ohlcMap = await getOhlcMap(keys, token, "/tmp/upstox_nse_ohlc_cache_eq.json");

  const rows = equities
    .map((i: any) => {
      const key = i.instrument_key as string;
      const daily = parseDaily(ohlcMap[key]);
      if (!daily.prevClose || !daily.close) return null;
      const pct = ((daily.close - daily.prevClose) / daily.prevClose) * 100;
      return {
        symbol: i.trading_symbol || i.name || key,
        close: daily.close,
        prevClose: daily.prevClose,
        volume: daily.volume,
        pct,
        key
      };
    })
    .filter(Boolean) as { symbol: string; close: number; prevClose: number; volume: number; pct: number; key: string }[];

  const candidates = rows
    .filter((r) => r.close > 50 && r.close < 1000)
    .filter((r) => r.volume > 50000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MAX_CANDIDATES);

  const filtered: { symbol: string; close: number; pct: number; volume: number }[] = [];

  for (const candidate of candidates) {
    const candles = await fetchHistoricalCandles(candidate.key, token, HIST_LOOKBACK_DAYS);
    if (!candles || candles.length === 0) continue;
    const volSma = computeSma(candles, 20, 5);
    const closeSma44 = computeSma(candles, 44, 4);
    if (!volSma || !closeSma44) continue;
    if (volSma.latest <= volSma.sma * 2) continue;
    if (candidate.close <= closeSma44.sma) continue;

    filtered.push({
      symbol: candidate.symbol,
      close: candidate.close,
      pct: candidate.pct,
      volume: candidate.volume
    });
    if (filtered.length >= 10) break;
  }

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    data: formatRows(filtered)
  });
}
