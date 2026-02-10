import { NextResponse } from "next/server";
import {
  getAccessToken,
  fetchInstruments,
  getOhlcMap,
  parseDaily,
  formatRows
} from "../_shared";

export async function GET() {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "No access token found. Please login via /upstox/login." }, { status: 401 });
  }

  const instruments = await fetchInstruments();
  const futures = instruments.filter(
    (i: any) => i.segment === "NSE_FO" && i.instrument_type === "FUT" && i.instrument_key
  );

  const keys = futures.map((i: any) => i.instrument_key as string);
  const ohlcMap = await getOhlcMap(keys, token, "/tmp/upstox_nse_ohlc_cache_fo.json");

  const rows = futures
    .map((i: any) => {
      const key = i.instrument_key as string;
      const daily = parseDaily(ohlcMap[key]);
      if (!daily.prevClose || !daily.close) return null;
      const pct = ((daily.close - daily.prevClose) / daily.prevClose) * 100;
      return {
        symbol: i.trading_symbol || i.name || key,
        close: daily.close,
        pct,
        volume: daily.volume
      };
    })
    .filter(Boolean) as { symbol: string; close: number; pct: number; volume: number }[];

  const filtered = rows
    .filter((r) => r.pct <= 0)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 10);

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    data: formatRows(filtered)
  });
}
