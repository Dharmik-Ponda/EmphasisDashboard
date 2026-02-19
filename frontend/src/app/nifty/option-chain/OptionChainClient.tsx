"use client";

import { useEffect, useRef, useState } from "react";

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
  }).format(value);
};

const formatCompact = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "-";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2).replace(/\.00$/, "")} L`;
  return `${sign}${formatNumber(abs)}`;
};

const toNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

const pickNumber = (obj: any, keys: string[]) => {
  if (!obj) return null;
  for (const k of keys) {
    const v = toNumber(obj[k]);
    if (v !== null) return v;
  }
  return null;
};

const oiLakhs = (oi: number | null) => (oi === null ? null : oi / 100000);

const getMarket = (opt: any) => {
  if (!opt || typeof opt !== "object") return {};
  return opt.market || opt.market_data || opt;
};

const getGreeks = (opt: any) => {
  if (!opt || typeof opt !== "object") return {};
  const g = opt.greeks || opt.option_greeks || {};
  return typeof g === "object" ? g : {};
};

const oiChange = (market: any) => {
  const oi = pickNumber(market, ["oi", "open_interest"]);
  const prevOi = pickNumber(market, ["prev_oi", "previous_oi"]);
  if (oi !== null && prevOi !== null) return oi - prevOi;
  return pickNumber(market, ["oi_change", "change_in_oi", "oi_change_percentage"]);
};

const parseThresholdPct = (value: string | undefined, fallbackPct = 15) => {
  if (!value) return fallbackPct / 100;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackPct / 100;
  return parsed / 100;
};

const diffRatioFromPrev = (prevValue: number, nextValue: number) => {
  const base = Math.abs(prevValue);
  if (base === 0) {
    if (nextValue === 0) return 0;
    return nextValue > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (nextValue - prevValue) / base;
};

type OptionChainData = {
  expiry: string;
  expiries: string[];
  underlying: number | null;
  spot_price?: number | null;
  maxPain: number | null;
  vix: number | null;
  step: number;
  window: number;
  chain: any[];
  priceHistory?: { time: string; open: number; high: number; low: number; close: number }[];
  priceHistory5m?: { time: string; open: number; high: number; low: number; close: number }[];
  priceHistory15m?: { time: string; open: number; high: number; low: number; close: number }[];
};

export default function OptionChainClient({
  initialData,
  symbol = "NIFTY 50",
  instrumentKey,
  vixKey = "NSE_INDEX|India VIX"
}: {
  initialData: OptionChainData;
  symbol?: string;
  instrumentKey?: string;
  vixKey?: string;
}) {
  const [data, setData] = useState<OptionChainData>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeExpiry, setActiveExpiry] = useState<string>(initialData.expiry);
  const ltpKeys = `${instrumentKey || "NSE_INDEX|Nifty 50"},${vixKey}`;
  const [lastLtpAt, setLastLtpAt] = useState(0);
  const prevChainData = useRef<any[]>([]);
  const [highlights, setHighlights] = useState<
    Record<string, { call?: string; put?: string }>
  >({});
  const oiChangeThresholdRatio = parseThresholdPct(
    process.env.NEXT_PUBLIC_OI_CHANGE_THRESHOLD_PCT,
    15
  );

  const spotPrice = data.underlying ?? data.spot_price ?? null;
  const atmStrike = spotPrice
    ? data.chain.reduce((best: number | null, row: any) => {
        const strike = toNumber(row.strike);
        if (strike === null) return best;
        if (best === null) return strike;
        return Math.abs(strike - spotPrice!) < Math.abs(best - spotPrice!)
          ? strike
          : best;
      }, null)
    : toNumber(data.chain[Math.floor(data.chain.length / 2)]?.strike);
  const atmIndex =
    atmStrike !== null ? data.chain.findIndex((row: any) => row.strike === atmStrike) : -1;
  const windowSize = data.window ?? 5;
  const start = atmIndex >= 0 ? Math.max(0, atmIndex - windowSize) : 0;
  const end = atmIndex >= 0 ? Math.min(data.chain.length, atmIndex + windowSize + 1) : data.chain.length;
  const visibleChain = data.chain.slice(start, end);
  const prevByStrike = new Map(prevChainData.current.map((row) => [String(row.strike), row]));
  const maxCallOi = Math.max(
    1,
    ...data.chain.map((row: any) => {
      const oi = pickNumber(getMarket(row.call), ["oi", "open_interest"]);
      return oi || 0;
    })
  );
  const maxPutOi = Math.max(
    1,
    ...data.chain.map((row: any) => {
      const oi = pickNumber(getMarket(row.put), ["oi", "open_interest"]);
      return oi || 0;
    })
  );
  const maxCallOiChg = Math.max(
    1,
    ...data.chain.map((row: any) => {
      const chg = oiChange(getMarket(row.call));
      return chg ? Math.abs(chg) : 0;
    })
  );
  const maxPutOiChg = Math.max(
    1,
    ...data.chain.map((row: any) => {
      const chg = oiChange(getMarket(row.put));
      return chg ? Math.abs(chg) : 0;
    })
  );

  const loadExpiry = async (expiry: string, silent = false) => {
    if (expiry === data.expiry && !silent) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/nifty/option-chain", window.location.origin);
      url.searchParams.set("expiry_date", expiry);
      if (instrumentKey) url.searchParams.set("instrument_key", instrumentKey);
      const res = await fetch(url.toString(), {
        cache: "no-store"
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next?.error || "Failed to load option chain");
      setData(next);
      setActiveExpiry(next.expiry || expiry);
    } catch (e: any) {
      setError(e?.message || "Failed to load option chain");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadLtp = async () => {
    const now = Date.now();
    if (now - lastLtpAt < 10000) return; // throttle to 10s
    try {
      const res = await fetch(`/api/upstox/ltp?keys=${encodeURIComponent(ltpKeys)}`, {
        cache: "no-store"
      });
      if (!res.ok) return;
      const json = await res.json();
      const dataObj = json?.data?.data || {};
      const pick = (token: string) => {
        const alt = token.replace("|", ":");
        const byKey = dataObj[token] || dataObj[alt];
        if (byKey?.last_price) return byKey.last_price as number;
        const byToken = Object.values(dataObj).find(
          (v: any) => v?.instrument_token === token || v?.instrument_token === alt
        ) as any;
        return byToken?.last_price ?? null;
      };
      const underlying = pick(instrumentKey || "NSE_INDEX|Nifty 50");
      const vix = pick(vixKey);
      if (underlying !== null || vix !== null) {
        setData((prev) => ({
          ...prev,
          underlying: underlying ?? prev.underlying,
          vix: vix ?? prev.vix
        }));
      }
      setLastLtpAt(now);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setData(initialData);
    setActiveExpiry(initialData.expiry);
    loadLtp();
  }, [initialData]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const url = new URL("/api/nifty/option-chain", window.location.origin);
        url.searchParams.set("expiry_date", activeExpiry);
        if (instrumentKey) url.searchParams.set("instrument_key", instrumentKey);
        const res = await fetch(url.toString(), {
          cache: "no-store"
        });
        const next = await res.json();
        if (!cancelled && res.ok) {
          if (prevChainData.current && prevChainData.current.length > 0) {
            const prevDataMap = new Map(
              prevChainData.current.map((row) => [row.strike, row])
            );
            const nextCallHighlights: Record<string, "highlight-green" | "highlight-red"> = {};
            const nextPutHighlights: Record<string, "highlight-green" | "highlight-red"> = {};

            for (const row of next.chain) {
              const prevRow = prevDataMap.get(row.strike);
              if (prevRow) {
                const prevCallOiChg = oiChange(getMarket(prevRow.call)) ?? 0;
                const currentCallOiChg = oiChange(getMarket(row.call)) ?? 0;
                const callDiffRatio = diffRatioFromPrev(prevCallOiChg, currentCallOiChg);

                if (callDiffRatio >= oiChangeThresholdRatio) {
                  nextCallHighlights[String(row.strike)] = "highlight-green";
                } else if (callDiffRatio <= -oiChangeThresholdRatio) {
                  nextCallHighlights[String(row.strike)] = "highlight-red";
                }

                const prevPutOiChg = oiChange(getMarket(prevRow.put)) ?? 0;
                const currentPutOiChg = oiChange(getMarket(row.put)) ?? 0;
                const putDiffRatio = diffRatioFromPrev(prevPutOiChg, currentPutOiChg);
                if (putDiffRatio >= oiChangeThresholdRatio) {
                  nextPutHighlights[String(row.strike)] = "highlight-green";
                } else if (putDiffRatio <= -oiChangeThresholdRatio) {
                  nextPutHighlights[String(row.strike)] = "highlight-red";
                }
              }
            }

            setHighlights((prevHighlights) => {
              const merged: Record<string, { call?: string; put?: string }> = {};
              const hasNewCallHighlights = Object.keys(nextCallHighlights).length > 0;
              const hasNewPutHighlights = Object.keys(nextPutHighlights).length > 0;

              if (hasNewCallHighlights) {
                for (const strike in nextCallHighlights) {
                  merged[strike] = {
                    ...(merged[strike] || {}),
                    call: nextCallHighlights[strike]
                  };
                }
              } else {
                for (const strike in prevHighlights) {
                  if (prevHighlights[strike].call) {
                    merged[strike] = {
                      ...(merged[strike] || {}),
                      call: prevHighlights[strike].call
                    };
                  }
                }
              }

              if (hasNewPutHighlights) {
                for (const strike in nextPutHighlights) {
                  merged[strike] = {
                    ...(merged[strike] || {}),
                    put: nextPutHighlights[strike]
                  };
                }
              } else {
                for (const strike in prevHighlights) {
                  if (prevHighlights[strike].put) {
                    merged[strike] = {
                      ...(merged[strike] || {}),
                      put: prevHighlights[strike].put
                    };
                  }
                }
              }

              return merged;
            });
          }
          prevChainData.current = next.chain;
          setData(next);
        }
      } catch {
        // silent refresh errors
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeExpiry, instrumentKey, oiChangeThresholdRatio]);

  useEffect(() => {
    const id = setInterval(loadLtp, 10000);
    return () => clearInterval(id);
  }, [lastLtpAt]);

  return (
    <>
      <style>
        {`
          .highlight-green {
            background-color: #dcfce7 !important;
            border-color: #86efac !important;
            transition: background-color 0.3s ease-out;
          }
          .highlight-red {
            background-color: #fee2e2 !important;
            border-color: #fca5a5 !important;
            transition: background-color 0.3s ease-out;
          }
        `}
      </style>
      <div className="oc-header">
        <div className="title-block">
          <div className="eyebrow">Option Chain</div>
          <h1>
            {symbol} <span className="muted">·</span> {data.expiry}
          </h1>
          <div className="subtitle">
            <span className="label">Underlying</span>
            <span className="value">{formatNumber(data.underlying)}</span>
            <span className="dot">•</span>
            <span className="label">Step</span>
            <span className="value">{formatNumber(data.step)}</span>
          </div>
        </div>
        <div className="right-stack">
          <div className="metrics">
            <span className="pill metric">
              <span className="label">Max Pain</span>
              <span className="value">{formatNumber(data.maxPain)}</span>
            </span>
            {data.vix !== null && (
              <span className="pill metric">
                <span className="label">India VIX</span>
                <span className="value">{formatNumber(data.vix)}</span>
              </span>
            )}
            {loading && <span className="pill">Loading…</span>}
          </div>
          <div className="expiry-tabs">
            {(data.expiries || []).map((exp: string) => (
              <button
                key={exp}
                type="button"
                className={exp === data.expiry ? "tab active" : "tab"}
                onClick={() => loadExpiry(exp)}
              >
                {exp}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap oc-table-wrap">
        <table className="chain">
          <thead>
            <tr>
              <th className="group calls" colSpan={9}>CALLS</th>
              <th className="group strike-group" colSpan={1}></th>
              <th className="group puts" colSpan={9}>PUTS</th>
            </tr>
            <tr>
              <th className="calls">Volume</th>
              <th className="calls">IV</th>
              <th className="calls">Vega</th>
              <th className="calls">Gamma</th>
              <th className="calls">Theta</th>
              <th className="calls">Delta</th>
              <th className="calls">OI (chg)</th>
              <th className="calls">OI (lakhs)</th>
              <th className="calls">LTP</th>
              <th className="strike-head">Strike</th>
              <th className="puts">LTP</th>
              <th className="puts">OI (lakhs)</th>
              <th className="puts">OI (chg)</th>
              <th className="puts">Delta</th>
              <th className="puts">Theta</th>
              <th className="puts">Gamma</th>
              <th className="puts">Vega</th>
              <th className="puts">IV</th>
              <th className="puts">Volume</th>
            </tr>
          </thead>
          <tbody>
            {visibleChain.map((row: any) => {
              const prevRow = prevByStrike.get(String(row.strike));
              const callMarket = getMarket(row.call);
              const callGreeks = getGreeks(row.call);
              const putMarket = getMarket(row.put);
              const putGreeks = getGreeks(row.put);

              const callLtp = pickNumber(callMarket, ["ltp", "last_price", "last_traded_price"]);
              const callOi = pickNumber(callMarket, ["oi", "open_interest"]);
              const callOiChg = oiChange(callMarket);
              const callVol = pickNumber(callMarket, ["volume", "volume_traded"]);
              const callIv = pickNumber(callGreeks, ["iv", "implied_volatility"]);
              const callDelta = pickNumber(callGreeks, ["delta"]);
              const callTheta = pickNumber(callGreeks, ["theta"]);
              const callGamma = pickNumber(callGreeks, ["gamma"]);
              const callVega = pickNumber(callGreeks, ["vega"]);

              const putLtp = pickNumber(putMarket, ["ltp", "last_price", "last_traded_price"]);
              const putOi = pickNumber(putMarket, ["oi", "open_interest"]);
              const putOiChg = oiChange(putMarket);
              const putVol = pickNumber(putMarket, ["volume", "volume_traded"]);
              const putIv = pickNumber(putGreeks, ["iv", "implied_volatility"]);
              const putDelta = pickNumber(putGreeks, ["delta"]);
              const putTheta = pickNumber(putGreeks, ["theta"]);
              const putGamma = pickNumber(putGreeks, ["gamma"]);
              const putVega = pickNumber(putGreeks, ["vega"]);
              const prevCallOiChg = prevRow ? oiChange(getMarket(prevRow.call)) : null;
              const prevPutOiChg = prevRow ? oiChange(getMarket(prevRow.put)) : null;
              const callOiPct = callOi ? Math.min(100, (callOi / maxCallOi) * 100) : 0;
              const putOiPct = putOi ? Math.min(100, (putOi / maxPutOi) * 100) : 0;
              const callOiChgPct = callOiChg ? Math.min(100, (Math.abs(callOiChg) / maxCallOiChg) * 100) : 0;
              const putOiChgPct = putOiChg ? Math.min(100, (Math.abs(putOiChg) / maxPutOiChg) * 100) : 0;
              const putOiPlusChange = (putOi ?? 0) + (putOiChg ?? 0);
              const callOiPlusChange = (callOi ?? 0) + (callOiChg ?? 0);
              const strikePcr =
                callOiPlusChange !== 0 ? putOiPlusChange / callOiPlusChange : null;
              const strikePcrTone =
                strikePcr === null ? "neutral" : strikePcr > 1 ? "bullish" : strikePcr < 1 ? "bearish" : "neutral";

              const isAtm = atmStrike !== null && row.strike === atmStrike;
              return (
                <tr key={row.strike} className={isAtm ? "row-atm" : undefined}>
                  <td className="calls">{formatCompact(callVol)}</td>
                  <td className="calls">{formatNumber(callIv)}</td>
                  <td className="calls">{formatNumber(callVega)}</td>
                  <td className="calls">{formatNumber(callGamma)}</td>
                  <td className="calls">{formatNumber(callTheta)}</td>
                  <td className="calls">{formatNumber(callDelta)}</td>
                  <td className={`calls ${highlights[row.strike]?.call || ""}`}>
                    <div className={`oi-bar call ${(callOiChg ?? 0) >= 0 ? "pos" : "neg"}`}>
                      <span style={{ width: `${callOiChgPct}%` }} />
                    </div>
                    <div>
                      {formatCompact(callOiChg)}
                      {prevCallOiChg !== null && callOiChg !== null && (
                        <span style={{ fontSize: "10px", opacity: 0.75 }}>
                          {" "}
                          ({formatCompact(prevCallOiChg)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="calls">
                    <div className="oi-bar call">
                      <span style={{ width: `${callOiPct}%` }} />
                    </div>
                    {formatCompact(oiLakhs(callOi))}
                  </td>
                  <td className="calls ltp">{formatNumber(callLtp)}</td>
                  <td className={isAtm ? "strike strike-atm" : "strike"}>
                    <div className="strike-main">{formatNumber(row.strike)}</div>
                    <div className={`strike-pcr ${strikePcrTone}`}>
                      PCR: {strikePcr === null ? "-" : strikePcr.toFixed(2)}
                    </div>
                  </td>
                  <td className="puts ltp">{formatNumber(putLtp)}</td>
                  <td className="puts">
                    <div className="oi-bar put">
                      <span style={{ width: `${putOiPct}%` }} />
                    </div>
                    {formatCompact(oiLakhs(putOi))}
                  </td>
                  <td className={`puts ${highlights[row.strike]?.put || ""}`}>
                    <div className={`oi-bar put ${(putOiChg ?? 0) >= 0 ? "pos" : "neg"}`}>
                      <span style={{ width: `${putOiChgPct}%` }} />
                    </div>
                    <div>
                      {formatCompact(putOiChg)}
                      {prevPutOiChg !== null && putOiChg !== null && (
                        <span style={{ fontSize: "10px", opacity: 0.75 }}>
                          {" "}
                          ({formatCompact(prevPutOiChg)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="puts">{formatNumber(putDelta)}</td>
                  <td className="puts">{formatNumber(putTheta)}</td>
                  <td className="puts">{formatNumber(putGamma)}</td>
                  <td className="puts">{formatNumber(putVega)}</td>
                  <td className="puts">{formatNumber(putIv)}</td>
                  <td className="puts">{formatCompact(putVol)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
