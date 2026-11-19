// Shared, in-memory cache for Upstox GET calls.
//
// Why: the option chain and the PCR panel each poll every 3 s and each poll made several
// Upstox calls (contracts, chain, LTP, quotes, VIX). Together that exceeded Upstox's rate
// limit ("UDAPI10005 Too Many Request Sent"), which is why spot/VIX kept coming back empty.
// Now identical requests within the TTL are answered from memory, concurrent identical
// requests share one network call, and if Upstox rate-limits we serve the last good answer.

type CacheEntry = { at: number; ok: boolean; status: number; data: any };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function ttlFor(url: string) {
  if (url.includes("/option/contract")) return 10 * 60 * 1000; // expiry list: 10 min
  if (url.includes("/historical-candle")) return 60 * 1000; // candles: 1 min
  return 6 * 1000; // chain, LTP, quotes: 6 s (≈4 calls / 6 s ≈ 1,200 per 30 min, under Upstox limits)
}

function isRateLimited(status: number, data: any) {
  if (status === 429) return true;
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  return errors.some((e: any) => (e?.errorCode || e?.error_code) === "UDAPI10005");
}

export async function upstoxCachedGet(url: string, token: string) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.ok && now - hit.at < ttlFor(url)) {
    return { ok: hit.ok, status: hit.status, data: hit.data, cached: true, ageMs: now - hit.at };
  }

  let p = inflight.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Api-Version": "2.0",
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });
      const data = await res.json().catch(() => ({}));
      return { at: Date.now(), ok: res.ok, status: res.status, data };
    })().finally(() => inflight.delete(url));
    inflight.set(url, p);
  }

  const fresh = await p;
  if (fresh.ok) {
    cache.set(url, fresh);
    return { ok: true, status: fresh.status, data: fresh.data, cached: false, ageMs: 0 };
  }
  // Rate-limited or temporary error: fall back to the last good answer (up to 2 minutes old).
  const stale = cache.get(url);
  if (stale && stale.ok && Date.now() - stale.at < 2 * 60 * 1000) {
    return {
      ok: true,
      status: stale.status,
      data: stale.data,
      cached: true,
      ageMs: Date.now() - stale.at,
      rateLimited: isRateLimited(fresh.status, fresh.data)
    };
  }
  return { ok: false, status: fresh.status, data: fresh.data, cached: false, ageMs: 0 };
}
