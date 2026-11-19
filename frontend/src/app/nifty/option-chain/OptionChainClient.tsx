"use client";

import { useEffect, useRef, useState } from "react";
import {
  getIntradayPicks,
  getIntradayPhase,
  getIstMinutes,
  HEDGE_WIDTH_POINTS,
  INTRADAY_STOP_PCT,
  INTRADAY_TARGET_PCT,
  type IntradayDirection,
  type SellerPick
} from "./StrikeScanner";

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
  }).format(value);
};

// Gamma for Nifty is ~0.0005–0.002, so 2 decimals showed 0 everywhere.
const formatGamma = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "-";
  return value.toFixed(4);
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
  const prevChainData = useRef<any[]>([]);
  const prevDifferentOiChg = useRef<
    Record<string, { call?: number | null; put?: number | null }>
  >({});
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
  // API returns ATM ±12; the table shows ATM ±8 so the ★ sell strikes are visible.
  const windowSize = 8;
  const start = atmIndex >= 0 ? Math.max(0, atmIndex - windowSize) : 0;
  const end = atmIndex >= 0 ? Math.min(data.chain.length, atmIndex + windowSize + 1) : data.chain.length;
  const visibleChain = data.chain.slice(start, end);
  const maxCallOi = Math.max(
    1,
    ...visibleChain.map((row: any) => {
      const oi = pickNumber(getMarket(row.call), ["oi", "open_interest"]);
      return oi || 0;
    })
  );
  const maxPutOi = Math.max(
    1,
    ...visibleChain.map((row: any) => {
      const oi = pickNumber(getMarket(row.put), ["oi", "open_interest"]);
      return oi || 0;
    })
  );
  const maxCallOiChg = Math.max(
    1,
    ...visibleChain.map((row: any) => {
      const chg = oiChange(getMarket(row.call));
      return chg ? Math.abs(chg) : 0;
    })
  );
  const maxPutOiChg = Math.max(
    1,
    ...visibleChain.map((row: any) => {
      const chg = oiChange(getMarket(row.put));
      return chg ? Math.abs(chg) : 0;
    })
  );

  // ---- Option-seller summary ----
  // Expected move = ATM call LTP + ATM put LTP (straddle price) for this expiry.
  const atmRow = atmStrike !== null ? data.chain.find((row: any) => row.strike === atmStrike) : null;
  const atmCallLtp = atmRow ? pickNumber(getMarket(atmRow.call), ["ltp", "last_price", "last_traded_price"]) : null;
  const atmPutLtp = atmRow ? pickNumber(getMarket(atmRow.put), ["ltp", "last_price", "last_traded_price"]) : null;
  // Only trust the straddle when we know the spot price (otherwise "ATM" is just the middle strike).
  const straddle =
    spotPrice && atmCallLtp !== null && atmPutLtp !== null ? atmCallLtp + atmPutLtp : null;
  const expectedLow = straddle !== null && spotPrice ? spotPrice - straddle : null;
  const expectedHigh = straddle !== null && spotPrice ? spotPrice + straddle : null;

  // ---- Intraday ★ (enter in the morning, square off by 3:15) ----
  // Direction comes from the Verdict card (PcrTableClient broadcasts it).
  const [verdictDirection, setVerdictDirection] = useState<IntradayDirection>(null);
  useEffect(() => {
    const initial = (window as any).__emphasisVerdict?.direction ?? null;
    if (initial) setVerdictDirection(initial);
    const onVerdict = (e: Event) => setVerdictDirection((e as CustomEvent).detail?.direction ?? null);
    window.addEventListener("emphasis:verdict", onVerdict);
    return () => window.removeEventListener("emphasis:verdict", onVerdict);
  }, []);

  const atmCallIv = atmRow ? pickNumber(getGreeks(atmRow.call), ["iv", "implied_volatility"]) : null;
  const atmPutIv = atmRow ? pickNumber(getGreeks(atmRow.put), ["iv", "implied_volatility"]) : null;
  const atmIv =
    atmCallIv && atmPutIv ? (atmCallIv + atmPutIv) / 2 : atmCallIv || atmPutIv || null;
  const istMinutes = getIstMinutes();
  const phase = getIntradayPhase(istMinutes);
  const { putPick, callPick, putWall, callWall, move: dayMove } = getIntradayPicks(
    visibleChain,
    spotPrice,
    atmIv,
    verdictDirection,
    istMinutes
  );
  const phaseInfo: Record<string, { label: string; tone: string; note: string }> = {
    PRE_OPEN: { label: "Pre-open", tone: "muted", note: "Market not open yet." },
    OPENING: { label: "Watch only", tone: "warn", note: "Opening period: watch, entries from 10:00." },
    ENTRY: { label: "Entry window", tone: "ok", note: "Entry window (10:00–1:30) if the Verdict says ENTER." },
    LATE: { label: "Late: small size", tone: "warn", note: "After 1:30: no new trades unless fully aligned, small size." },
    SQUARE_OFF: { label: "Square off by 3:15", tone: "bad", note: "Close all intraday positions by 3:15." },
    CLOSED: { label: "Closed", tone: "muted", note: "Market closed." }
  };
  const phaseView = phaseInfo[phase];
  const pickTitle = (p: SellerPick) => {
    const stop = p.ltp * (1 + INTRADAY_STOP_PCT / 100);
    const target = p.ltp * (1 - INTRADAY_TARGET_PCT / 100);
    const dirText =
      verdictDirection === "BULLISH" || verdictDirection === "BEARISH"
        ? `Verdict ${verdictDirection}`
        : "No clear direction: neutral, both sides shown";
    return (
      `★ Intraday sell ${p.strike} ${p.side} @ ${p.ltp.toFixed(2)} · Δ ${p.delta.toFixed(2)} · Θ ${p.theta.toFixed(1)}/day` +
      `\nStop ${stop.toFixed(2)} (+${INTRADAY_STOP_PCT}%) · Target ${target.toFixed(2)} (−${INTRADAY_TARGET_PCT}%) · Square off by 3:15` +
      `\n${dirText} · Rest-of-day move ±${dayMove !== null ? Math.round(dayMove) : "-"} pts` +
      (p.hedgeStrike !== null && p.spreadCredit !== null
        ? `\nOptional hedge (lower margin): buy ${p.hedgeStrike} ${p.side} → spread credit ${p.spreadCredit.toFixed(
            2
          )}, max loss ${(HEDGE_WIDTH_POINTS - p.spreadCredit).toFixed(2)}`
        : "") +
      `\n${phaseView.note}` +
      `\nRule: Δ 0.25–0.40 strike with the best decay per unit of risk for the rest of today.`
    );
  };

  const loadExpiry = async (expiry: string, silent = false) => {
    if (expiry === data.expiry && !silent) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/nifty/option-chain", window.location.origin);
      url.searchParams.set("expiry_date", expiry);
      url.searchParams.set("window", "12");
      if (instrumentKey) url.searchParams.set("instrument_key", instrumentKey);
      const res = await fetch(url.toString(), {
        cache: "no-store"
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next?.error || "Failed to load option chain");
      prevChainData.current = next.chain;
      prevDifferentOiChg.current = {};
      setData(next);
      setActiveExpiry(next.expiry || expiry);
    } catch (e: any) {
      setError(e?.message || "Failed to load option chain");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    prevChainData.current = initialData.chain;
    prevDifferentOiChg.current = {};
    setData(initialData);
    setActiveExpiry(initialData.expiry);
  }, [initialData]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const url = new URL("/api/nifty/option-chain", window.location.origin);
        url.searchParams.set("expiry_date", activeExpiry);
        url.searchParams.set("window", "12");
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
                const strikeKey = String(row.strike);
                if (currentCallOiChg !== prevCallOiChg) {
                  prevDifferentOiChg.current[strikeKey] = {
                    ...(prevDifferentOiChg.current[strikeKey] || {}),
                    call: prevCallOiChg
                  };
                } else if (prevDifferentOiChg.current[strikeKey]?.call === currentCallOiChg) {
                  prevDifferentOiChg.current[strikeKey] = {
                    ...(prevDifferentOiChg.current[strikeKey] || {}),
                    call: null
                  };
                }
                const callDiffRatio = diffRatioFromPrev(prevCallOiChg, currentCallOiChg);

                if (callDiffRatio >= oiChangeThresholdRatio) {
                  nextCallHighlights[String(row.strike)] = "highlight-green";
                } else if (callDiffRatio <= -oiChangeThresholdRatio) {
                  nextCallHighlights[String(row.strike)] = "highlight-red";
                }

                const prevPutOiChg = oiChange(getMarket(prevRow.put)) ?? 0;
                const currentPutOiChg = oiChange(getMarket(row.put)) ?? 0;
                if (currentPutOiChg !== prevPutOiChg) {
                  prevDifferentOiChg.current[strikeKey] = {
                    ...(prevDifferentOiChg.current[strikeKey] || {}),
                    put: prevPutOiChg
                  };
                } else if (prevDifferentOiChg.current[strikeKey]?.put === currentPutOiChg) {
                  prevDifferentOiChg.current[strikeKey] = {
                    ...(prevDifferentOiChg.current[strikeKey] || {}),
                    put: null
                  };
                }
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

  return (
    <>
      <style>
        {`
          .highlight-green {
            background-color: #dcfce7 !important;
            border-color: #86efac !important;
            transition: background-color 0.3s ease-out;
          }
          .oc-bar {
            display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
            padding: 8px 12px; margin: 8px 0; background: #fff;
            border: 1px solid #e5e7eb; border-radius: 12px; font-size: 13px;
          }
          .oc-bar .oc-title { font-size: 17px; font-weight: 800; color: #0f172a; white-space: nowrap; }
          .oc-bar .oc-item { white-space: nowrap; }
          .oc-bar .label {
            font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
            color: #64748b; margin-right: 5px;
          }
          .oc-bar b { color: #0f172a; }
          .oc-phase {
            font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 10px; white-space: nowrap;
            border: 1px solid transparent;
          }
          .oc-phase.ok { background: #dcfce7; color: #166534; border-color: #86efac; }
          .oc-phase.warn { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
          .oc-phase.bad { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
          .oc-phase.muted { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
          .oc-expiries { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
          .oc-exp {
            border: 1px solid #e2e8f0; background: #fff; border-radius: 8px;
            padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer; color: #0f172a;
          }
          .oc-exp.active { background: #0f2a5f; color: #fff; border-color: #0f2a5f; }
          /* Compact rows: less top/bottom padding so more strikes fit on one screen. */
          .oc-table-wrap table.chain tbody td { padding-top: 5px; padding-bottom: 5px; line-height: 1.2; }
          .oc-table-wrap table.chain thead th { padding-top: 6px; padding-bottom: 6px; }
          .oc-table-wrap .oi-bar { margin-bottom: 2px !important; }
          .oc-table-wrap td > div:not(.oi-bar) { white-space: nowrap; }
          .oc-table-wrap .strike-main { line-height: 1.15; }
          .oc-table-wrap .strike-pcr {
            margin-top: 1px !important; padding-top: 0 !important; padding-bottom: 0 !important;
            font-size: 10px !important; line-height: 1.4 !important; white-space: nowrap;
          }
          /* ★ sell strike: navy theme tint + outline; marks are absolutely positioned
             so they never change row height or column width. */
          td.oc-pick {
            position: relative;
            background-color: rgba(30, 58, 138, 0.10) !important;
            box-shadow: inset 0 0 0 2px #1e3a8a;
            color: #1e3a8a;
            font-weight: 700;
          }
          td.oc-has-wall { position: relative; }
          .oc-star {
            position: absolute; top: 3px; left: 5px;
            font-size: 11px; line-height: 1; color: #1e3a8a; cursor: help;
          }
          .oc-wall {
            position: absolute; top: 3px; right: 4px;
            font-size: 9px; line-height: 1.3; font-weight: 700; white-space: nowrap;
            background: #1e3a8a; color: #fff; border-radius: 4px; padding: 0 4px; cursor: help;
          }
          .highlight-red {
            background-color: #fee2e2 !important;
            border-color: #fca5a5 !important;
            transition: background-color 0.3s ease-out;
          }
        `}
      </style>
      <div className="oc-bar">
        <span className="oc-title">
          {symbol} <span className="muted">·</span> {data.expiry}
        </span>
        <span className="oc-item">
          <span className="label">Spot</span>
          <b>{formatNumber(spotPrice)}</b>
        </span>
        <span className="oc-item">
          <span className="label">Step</span>
          <b>{formatNumber(data.step)}</b>
        </span>
        {data.vix !== null && (
          <span className="oc-item">
            <span className="label">VIX</span>
            <b>{formatNumber(data.vix)}</b>
          </span>
        )}
        <span className="oc-item" title="ATM call + ATM put premium. Market's expected move by expiry.">
          <span className="label">ATM Straddle</span>
          <b>{formatNumber(straddle)}</b>
        </span>
        <span
          className="oc-item"
          title="Spot ± ATM straddle. Selling outside this range keeps you outside the expected move."
        >
          <span className="label">Expected Range</span>
          <b>
            {expectedLow !== null && expectedHigh !== null
              ? `${formatNumber(Math.round(expectedLow))} – ${formatNumber(Math.round(expectedHigh))}`
              : "-"}
          </b>
        </span>
        <span
          className="oc-item"
          title="1-SD Nifty move expected for the rest of today's session (from ATM IV). Intraday ★ uses this."
        >
          <span className="label">Rest-of-Day Move</span>
          <b>{dayMove !== null ? `±${Math.round(dayMove)}` : "-"}</b>
        </span>
        <span className={`oc-phase ${phaseView.tone}`} title={phaseView.note}>
          {phaseView.label}
        </span>
        {loading && <span className="oc-item">Loading…</span>}
        <span className="oc-expiries">
          {(data.expiries || []).map((exp: string) => (
            <button
              key={exp}
              type="button"
              className={exp === data.expiry ? "oc-exp active" : "oc-exp"}
              onClick={() => loadExpiry(exp)}
            >
              {exp}
            </button>
          ))}
        </span>
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
              const prevDiff = prevDifferentOiChg.current[String(row.strike)];
              const prevCallOiChg = prevDiff?.call ?? null;
              const prevPutOiChg = prevDiff?.put ?? null;
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
              const isCallPick = callPick?.strike === row.strike;
              const isPutPick = putPick?.strike === row.strike;
              const isCallWall = callWall?.strike === row.strike;
              const isPutWall = putWall?.strike === row.strike;
              return (
                <tr key={row.strike} className={isAtm ? "row-atm" : undefined}>
                  <td className="calls">{formatCompact(callVol)}</td>
                  <td className="calls">{formatNumber(callIv)}</td>
                  <td className="calls">{formatNumber(callVega)}</td>
                  <td className="calls">{formatGamma(callGamma)}</td>
                  <td className="calls">{formatNumber(callTheta)}</td>
                  <td className="calls">{formatNumber(callDelta)}</td>
                  <td className={`calls ${highlights[row.strike]?.call || ""}`}>
                    <div className={`oi-bar call ${(callOiChg ?? 0) >= 0 ? "pos" : "neg"}`}>
                      <span style={{ width: `${callOiChgPct}%` }} />
                    </div>
                    <div>
                      {formatCompact(callOiChg)}
                      {prevCallOiChg !== null &&
                        callOiChg !== null &&
                        callOiChg !== prevCallOiChg && (
                        <span style={{ fontSize: "10px", opacity: 0.75 }}>
                          {" "}
                          ({formatCompact(prevCallOiChg)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`calls ${isCallWall ? "oc-has-wall" : ""}`}>
                    <div className="oi-bar call">
                      <span style={{ width: `${callOiPct}%` }} />
                    </div>
                    {formatCompact(oiLakhs(callOi))}
                    {isCallWall && (
                      <span className="oc-wall" title="Biggest call OI above spot: resistance">
                        OI wall
                      </span>
                    )}
                  </td>
                  <td
                    className={`calls ltp ${isCallPick ? "oc-pick" : ""}`}
                    title={isCallPick && callPick ? pickTitle(callPick) : undefined}
                  >
                    {isCallPick && <span className="oc-star">★</span>}
                    {formatNumber(callLtp)}
                  </td>
                  <td className={isAtm ? "strike strike-atm" : "strike"}>
                    <div className="strike-main">{formatNumber(row.strike)}</div>
                    <div className={`strike-pcr ${strikePcrTone}`}>
                      PCR: {strikePcr === null ? "-" : strikePcr.toFixed(2)}
                    </div>
                  </td>
                  <td
                    className={`puts ltp ${isPutPick ? "oc-pick" : ""}`}
                    title={isPutPick && putPick ? pickTitle(putPick) : undefined}
                  >
                    {isPutPick && <span className="oc-star">★</span>}
                    {formatNumber(putLtp)}
                  </td>
                  <td className={`puts ${isPutWall ? "oc-has-wall" : ""}`}>
                    <div className="oi-bar put">
                      <span style={{ width: `${putOiPct}%` }} />
                    </div>
                    {formatCompact(oiLakhs(putOi))}
                    {isPutWall && (
                      <span className="oc-wall" title="Biggest put OI below spot: support">
                        OI wall
                      </span>
                    )}
                  </td>
                  <td className={`puts ${highlights[row.strike]?.put || ""}`}>
                    <div className={`oi-bar put ${(putOiChg ?? 0) >= 0 ? "pos" : "neg"}`}>
                      <span style={{ width: `${putOiChgPct}%` }} />
                    </div>
                    <div>
                      {formatCompact(putOiChg)}
                      {prevPutOiChg !== null &&
                        putOiChg !== null &&
                        putOiChg !== prevPutOiChg && (
                        <span style={{ fontSize: "10px", opacity: 0.75 }}>
                          {" "}
                          ({formatCompact(prevPutOiChg)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="puts">{formatNumber(putDelta)}</td>
                  <td className="puts">{formatNumber(putTheta)}</td>
                  <td className="puts">{formatGamma(putGamma)}</td>
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
