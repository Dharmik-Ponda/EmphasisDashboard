import { NextResponse } from "next/server";
import {
  getAccessToken,
  fetchInstruments,
  getOhlcMap,
  parseDaily
} from "../_shared";

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
        volume: daily.volume,
        pct
      };
    })
    .filter(Boolean) as { symbol: string; close: number; volume: number; pct: number }[];

  const filtered = rows
    .filter((r) => r.close > 50)
    .filter((r) => r.volume > 500000)
    .filter((r) => r.pct > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6)
    .map((r) => ({
      label: r.symbol,
      value: Math.round(r.volume)
    }));

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    data: filtered
  });
}
