import fs from "fs";
import path from "path";
import zlib from "zlib";
import { prisma } from "@/lib/prisma";

export const UPSTOX_API = "https://api.upstox.com/v2";
export const INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
export const CACHE_DIR = "/tmp";
export const INSTRUMENTS_CACHE = path.join(CACHE_DIR, "upstox_nse_instruments.json");
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const QUOTE_TTL_MS = 5 * 60 * 1000;
export const BATCH_SIZE = 500;

export async function getAccessToken() {
  const latest = await prisma.upstoxSession.findFirst({ orderBy: { createdAt: "desc" } });
  if (!latest?.accessToken) return null;
  return latest.accessToken;
}

export async function fetchInstruments() {
  try {
    const stat = fs.statSync(INSTRUMENTS_CACHE);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(INSTRUMENTS_CACHE, "utf8"));
    }
  } catch {
    // cache miss
  }

  const res = await fetch(INSTRUMENTS_URL);
  if (!res.ok) {
    throw new Error("Failed to download instruments");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const json = zlib.gunzipSync(buf).toString("utf8");
  fs.writeFileSync(INSTRUMENTS_CACHE, json);
  return JSON.parse(json);
}

export function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchOhlcBatch(keys: string[], token: string) {
  const params = new URLSearchParams({
    instrument_key: keys.join(","),
    interval: "1d"
  });

  const res = await fetch(`${UPSTOX_API}/market-quote/ohlc?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    throw new Error("Failed to fetch OHLC batch");
  }
  return res.json();
}

export async function getOhlcMap(keys: string[], token: string, cacheKey: string) {
  try {
    const stat = fs.statSync(cacheKey);
    if (Date.now() - stat.mtimeMs < QUOTE_TTL_MS) {
      const cached = JSON.parse(fs.readFileSync(cacheKey, "utf8"));
      return cached;
    }
  } catch {
    // ignore
  }

  const batches = chunkArray(keys, BATCH_SIZE);
  const result: Record<string, any> = {};

  for (const batch of batches) {
    const data = await fetchOhlcBatch(batch, token);
    if (data?.data) {
      Object.assign(result, data.data);
    }
  }

  fs.writeFileSync(cacheKey, JSON.stringify(result));
  return result;
}

export function parseDaily(data: any) {
  const ohlc = data?.ohlc || data;
  const close = Number(ohlc?.close ?? ohlc?.last_price ?? ohlc?.ltp ?? 0);
  const prevClose = Number(ohlc?.prev_close ?? ohlc?.prevClose ?? ohlc?.close_price ?? 0);
  const volume = Number(ohlc?.volume ?? data?.volume ?? 0);
  const high = Number(ohlc?.high ?? 0);
  const low = Number(ohlc?.low ?? 0);
  return { close, prevClose, volume, high, low };
}

export function formatRows(rows: { symbol: string; close: number; pct: number; volume?: number }[]) {
  return rows.map((r) => ({
    symbol: r.symbol,
    price: r.close.toFixed(2),
    pct: r.pct.toFixed(2),
    volume: r.volume ? Math.round(r.volume).toLocaleString("en-IN") : "-"
  }));
}

export function formatDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function fetchHistoricalCandles(key: string, token: string, lookbackDays: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);

  const url = `${UPSTOX_API}/historical-candle/${encodeURIComponent(key)}/day/${formatDate(to)}/${formatDate(from)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  return data?.data?.candles || [];
}

export function computeSma(candles: any[], period: number, index: number) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const values = candles.map((c) => Number(c[index] ?? 0)).filter((v) => Number.isFinite(v));
  if (values.length < period + 1) return null;
  const latest = values[values.length - 1];
  const window = values.slice(-1 - period, -1);
  const sma = window.reduce((acc, v) => acc + v, 0) / window.length;
  return { sma, latest };
}

export async function fetchIntradayCandles(key: string, token: string) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 5);

  const url = `${UPSTOX_API}/historical-candle/${encodeURIComponent(key)}/15minute/${formatDate(to)}/${formatDate(from)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.candles || [];
}
