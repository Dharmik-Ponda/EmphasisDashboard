"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

const parseThresholdPct = (value: string | undefined, fallbackPct = 5) => {
  if (!value) return fallbackPct / 100;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackPct / 100;
  return parsed / 100;
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
  const [history5m, setHistory5m] = useState(
    initialData.priceHistory5m ?? initialData.priceHistory ?? []
  );
  const [history15m, setHistory15m] = useState(initialData.priceHistory15m ?? []);
  const [lastDivergenceAt, setLastDivergenceAt] = useState<number | null>(null);
  const divergenceCooldown = 10 * 60 * 1000; // 10 minutes
  const prevDivergence = useRef(false);
  const ltpKeys = `${instrumentKey || "NSE_INDEX|Nifty 50"},${vixKey}`;
  const [lastLtpAt, setLastLtpAt] = useState(0);
  const prevChainData = useRef<any[]>([]);
  const [highlights, setHighlights] = useState<
    Record<string, { call?: string; put?: string }>
  >({});
  const oiChangeThresholdRatio = parseThresholdPct(
    process.env.NEXT_PUBLIC_OI_CHANGE_THRESHOLD_PCT,
    5
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

  const signal = useMemo(() => {
    const spot = spotPrice;
    if (!spot || !data.chain.length) {
      return {
        alignment: false,
        divergence: false,
        structureView: "NEUTRAL" as const,
        priceState: "NEUTRAL" as const,
        note: "⚠️ Indecisive — WAIT",
        computedSupport: null,
        computedResistance: null,
        nearSupport: false,
        nearResistance: false
      };
    }

    const range = 200;
    const levelBuffer = Math.max(data.step || 50, 20);

    const scan =
      data.chain.filter((row: any) => {
        const strike = toNumber(row.strike);
        return strike !== null && Math.abs(strike - spot) <= range;
      }) || data.chain;

    let resistance: number | null = null;
    let support: number | null = null;
    let maxCall = -Infinity;
    let maxPut = -Infinity;

    for (const row of scan) {
      const strike = toNumber(row.strike);
      if (strike === null) continue;

      const callOi = pickNumber(getMarket(row.call), ["oi", "open_interest"]) || 0;
      const putOi = pickNumber(getMarket(row.put), ["oi", "open_interest"]) || 0;

      if (callOi > maxCall) {
        maxCall = callOi;
        resistance = strike;
      }
      if (putOi > maxPut) {
        maxPut = putOi;
        support = strike;
      }
    }

    const resistanceRow = scan.find((r: any) => r.strike === resistance);
    const supportRow = scan.find((r: any) => r.strike === support);

    const callOiChg = resistanceRow ? oiChange(getMarket(resistanceRow.call)) ?? 0 : 0;
    const putOiChgAtRes = resistanceRow ? oiChange(getMarket(resistanceRow.put)) ?? 0 : 0;
    const putOiChg = supportRow ? oiChange(getMarket(supportRow.put)) ?? 0 : 0;

    const nearResistance = resistance !== null && Math.abs(spot - resistance) <= levelBuffer;
    const nearSupport = support !== null && Math.abs(spot - support) <= levelBuffer;

    /* -------- PRICE STATE (TACTICAL) -------- */

    const threshold = Math.max(spot * 0.0012, (data.step || 50) * 0.3);

    const candleMove = (candles: typeof history5m) => {
      if (!candles || candles.length < 2) return "FLAT";
      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const delta = last.close - prev.close;
      if (delta >= threshold) return "UP_STRONG";
      if (delta <= -threshold) return "DOWN_STRONG";
      return "FLAT";
    };

    const move5m = candleMove(history5m);
    const move15m = candleMove(history15m);

    const strongUp =
      move5m === "UP_STRONG" && (move15m === "UP_STRONG" || history15m.length === 0);
    const strongDown =
      move5m === "DOWN_STRONG" && (move15m === "DOWN_STRONG" || history15m.length === 0);

    let priceState: "STRONG_UP" | "STRONG_DOWN" | "WEAK" | "NEUTRAL" = "NEUTRAL";

    if (strongUp) priceState = "STRONG_UP";
    else if (strongDown) priceState = "STRONG_DOWN";
    else if (nearResistance || nearSupport) priceState = "WEAK";

    /* -------- REJECTION / ACCEPTANCE -------- */

    const wickRejection = (candle: any) =>
      candle &&
      candle.high - candle.close >= (candle.high - candle.low) * 0.5;

    const last5mCandle = history5m?.[history5m.length - 1];
    const rejectedFromResistance =
      strongDown || (last5mCandle ? wickRejection(last5mCandle) : false);

    const acceptanceZone =
      nearResistance && callOiChg >= 0 && !rejectedFromResistance;

    /* -------- STRUCTURAL ALIGNMENT -------- */

    const callAlignment =
      nearResistance &&
      callOiChg >= 0 &&
      callOiChg >= putOiChgAtRes &&
      rejectedFromResistance;

    const putAlignment = nearSupport && putOiChg >= 0;

    const alignment = callAlignment || putAlignment;

    const divergence =
      nearResistance &&
      callOiChg > 0 &&
      strongUp &&
      !rejectedFromResistance;

    /* -------- STRUCTURE VIEW (DOMINANT) -------- */

    let structureView: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

    if (callAlignment && putAlignment) {
      structureView =
        Math.abs(spot - (resistance ?? 0)) <= Math.abs(spot - (support ?? 0))
          ? "BEARISH"
          : "BULLISH";
    } else if (callAlignment) {
      structureView = "BEARISH";
    } else if (putAlignment) {
      structureView = "BULLISH";
    }

    /* -------- NOTE -------- */

    let note = "⚠️ Indecisive — WAIT";

    if (divergence) {
      note = "❌ OI–Price Divergence — NO TRADE";
    } else if (acceptanceZone) {
      note = "⚠️ Price near resistance without rejection — WAIT";
    } else if (alignment) {
      note = "✅ OI–Price Aligned — TRADE POSSIBLE";
    }

    if (lastDivergenceAt && Date.now() - lastDivergenceAt < divergenceCooldown) {
      note = "❌ Recent divergence — NO TRADE";
    }

    return {
      alignment,
      divergence,
      structureView,
      priceState,
      note,
      computedSupport: support,
      computedResistance: resistance,
      nearSupport,
      nearResistance
    };
  }, [data.chain, data.step, history5m, history15m, spotPrice]);


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
    setHistory5m(initialData.priceHistory5m ?? initialData.priceHistory ?? []);
    setHistory15m(initialData.priceHistory15m ?? []);
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
            const callThreshold = maxCallOiChg * oiChangeThresholdRatio;
            const putThreshold = maxPutOiChg * oiChangeThresholdRatio;

            const prevDataMap = new Map(
              prevChainData.current.map((row) => [row.strike, row])
            );
            const nextCallHighlights: Record<string, string> = {};
            const nextPutHighlights: Record<string, string> = {};

            for (const row of next.chain) {
              const prevRow = prevDataMap.get(row.strike);
              if (prevRow) {
                const prevCallOiChg = oiChange(getMarket(prevRow.call)) ?? 0;
                const currentCallOiChg = oiChange(getMarket(row.call)) ?? 0;
                const callDiff = currentCallOiChg - prevCallOiChg;
                if (callDiff >= callThreshold) {
                  nextCallHighlights[row.strike] = "highlight-green";
                } else if (callDiff <= -callThreshold) {
                  nextCallHighlights[row.strike] = "highlight-red";
                }

                const prevPutOiChg = oiChange(getMarket(prevRow.put)) ?? 0;
                const currentPutOiChg = oiChange(getMarket(row.put)) ?? 0;
                const putDiff = currentPutOiChg - prevPutOiChg;
                if (putDiff >= putThreshold) {
                  nextPutHighlights[row.strike] = "highlight-green";
                } else if (putDiff <= -putThreshold) {
                  nextPutHighlights[row.strike] = "highlight-red";
                }
              }
            }

            const hasNewCallHighlights = Object.keys(nextCallHighlights).length > 0;
            const hasNewPutHighlights = Object.keys(nextPutHighlights).length > 0;

            setHighlights((prevHighlights) => {
              const merged: Record<string, { call?: string; put?: string }> = {};

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
  }, [activeExpiry]);

  useEffect(() => {
    const id = setInterval(loadLtp, 10000);
    return () => clearInterval(id);
  }, [lastLtpAt]);

  useEffect(() => {
    if (signal.divergence && !prevDivergence.current) {
      setLastDivergenceAt(Date.now());
    }
    prevDivergence.current = signal.divergence;
  }, [signal.divergence]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const url = new URL("/api/nifty/option-chain", window.location.origin);
        url.searchParams.set("expiry_date", activeExpiry);
        url.searchParams.set("include_history", "1");
        if (instrumentKey) url.searchParams.set("instrument_key", instrumentKey);
        const res = await fetch(url.toString(), { cache: "no-store" });
        const next = await res.json();
        if (!cancelled && res.ok) {
          setHistory5m(next?.priceHistory5m || []);
          setHistory15m(next?.priceHistory15m || []);
        }
      } catch {
        // ignore
      }
    };
    loadHistory();
    const id = setInterval(loadHistory, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeExpiry, instrumentKey]);

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
      <div
        className={`oi-signal-banner ${
          signal.divergence ? "diverging" : signal.alignment ? "aligned" : "indecisive"
        }`}
        title="This signal is based on mismatch between price direction and OI change."
      >
        <div className="oi-signal-main">
          <div className="oi-signal-badge">
            {signal.divergence
              ? "OI–Price Diverging"
              : signal.alignment
                ? "OI–Price Aligned"
                : "Indecisive"}
          </div>
          <div className="oi-signal-note">{signal.note}</div>
        </div>
        <div className="oi-signal-meta">
          <span>
            Resistance: <strong>{formatNumber(signal.computedResistance)}</strong>
          </span>
          <span>
            Support: <strong>{formatNumber(signal.computedSupport)}</strong>
          </span>
          <span>
            Dominant (Structure): <strong>{signal.structureView}</strong>
          </span>
          <span>
            Price State: <strong>{signal.priceState}</strong>
          </span>
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
              const callOiPct = callOi ? Math.min(100, (callOi / maxCallOi) * 100) : 0;
              const putOiPct = putOi ? Math.min(100, (putOi / maxPutOi) * 100) : 0;
              const callOiChgPct = callOiChg ? Math.min(100, (Math.abs(callOiChg) / maxCallOiChg) * 100) : 0;
              const putOiChgPct = putOiChg ? Math.min(100, (Math.abs(putOiChg) / maxPutOiChg) * 100) : 0;

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
                    {formatCompact(callOiChg)}
                  </td>
                  <td className="calls">
                    <div className="oi-bar call">
                      <span style={{ width: `${callOiPct}%` }} />
                    </div>
                    {formatCompact(oiLakhs(callOi))}
                  </td>
                  <td className="calls ltp">{formatNumber(callLtp)}</td>
                  <td className={isAtm ? "strike strike-atm" : "strike"}>
                    {formatNumber(row.strike)}
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
                    {formatCompact(putOiChg)}
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
