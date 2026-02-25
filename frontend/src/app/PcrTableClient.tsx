"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PcrRecord = Record<string, string | number>;
type DisplayRow = {
  key: string;
  seenAt: number;
  row: PcrRecord;
};
type Tone = "bullish" | "bearish" | "neutral";
type TrendView = {
  tone: Tone;
  title: string;
  subtitle: string;
  trail: string;
  latest: number | null;
  slope: number;
  windowLabel: "3m" | "5m";
};
type JournalEntry = {
  id: string;
  at: string;
  direction: "BULLISH" | "BEARISH";
  score: number;
  reason: string;
};
type PcrSamplePoint = {
  at: number;
  value: number;
};

type PcrResponse = {
  records: PcrRecord[];
  sentiment: { label: string; tone: "bullish" | "bearish" | "neutral" };
  trend: string;
  peBuildUp?: { strike: number | null; oiChange: number };
  peReduction?: { strike: number | null; oiChange: number };
  ceBuildUp?: { strike: number | null; oiChange: number };
  ceReduction?: { strike: number | null; oiChange: number };
  signals?: {
    pcrSignal: string;
    pcrTone: Tone;
    buildUpSignal: string;
    buildUpStrike?: number | null;
  };
  underlying?: number | null;
  vix?: number | null;
  vwap?: number | null;
  vwapSignal?: string;
};

const headers = [
  "Time",
  "PE Total OI Change",
  "CE Total OI Change",
  "PE OI Change (±2)",
  "CE OI Change (±2)",
  "ALL Change OI PCR",
  "Current Change OI PCR",
  "Current All OI PCR"
];

const formatVolume = (value: number) => {
  if (!Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2).replace(/\.00$/, "")} L`;
  return `${sign}${Math.round(abs).toLocaleString("en-IN")}`;
};

const isRatioColumn = (h: string) =>
  h.includes("PCR") || h === "Time";

const buildRowKey = (row: PcrRecord) =>
  headers.map((h) => String(row[h] ?? "")).join("|");

const toNumeric = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatPcrTrail = (values: number[]) => values.map((v) => `|${v.toFixed(2)}|`).join(" ");
const formatPeakToLatestTrail = (peak: number, latest: number) =>
  `|${peak.toFixed(2)}| -> |${latest.toFixed(2)}|`;
const formatTroughToLatestTrail = (trough: number, latest: number) =>
  `|${trough.toFixed(2)}| -> |${latest.toFixed(2)}|`;
const MAX_ROWS = 5;
const HISTORY_MAX_ROWS = 10000;
const THREE_MIN_MS = 3 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const TREND_SOURCE = "ALL Change OI PCR";
const MAX_JOURNAL_ROWS = 14;
const DEFAULT_STRIKE_STEP = 50;
const OTM_OFFSET_POINTS = 200;
const HEDGE_OFFSET_POINTS = 200;
const MAX_PCR_SAMPLES = 600;

const mergeIncomingRows = (previousRows: DisplayRow[], incomingRecords: PcrRecord[]) => {
  if (!incomingRecords.length) return previousRows;

  // API records are oldest -> latest; preserve that and only append unseen rows.
  const incomingOrdered = incomingRecords.slice(-MAX_ROWS);
  const previousKeys = new Set(previousRows.map((item) => item.key));
  const merged = [...previousRows];
  const now = Date.now();
  let offsetMs = 0;

  for (const row of incomingOrdered) {
    const key = buildRowKey(row);
    if (previousKeys.has(key)) continue;
    previousKeys.add(key);
    merged.push({
      key,
      row,
      seenAt: now + offsetMs
    });
    offsetMs += 1;
  }

  return merged.slice(-HISTORY_MAX_ROWS);
};

const parseCompactVolume = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.replace(/,/g, "").trim();
  if (!raw) return null;
  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*(Cr|L)?$/i);
  if (!match) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] || "").toLowerCase();
  if (unit === "cr") return num * 1e7;
  if (unit === "l") return num * 1e5;
  return num;
};

const getIstSessionPhase = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type === "hour" || part.type === "minute") acc[part.type] = part.value;
      return acc;
    }, {});
  const hour = Number(parts.hour || "0");
  const minute = Number(parts.minute || "0");
  const total = hour * 60 + minute;

  if (total >= 9 * 60 + 15 && total < 10 * 60) {
    return { name: "Opening Drive", multiplier: 1.08 };
  }
  if (total >= 10 * 60 && total < 13 * 60 + 30) {
    return { name: "Trend Window", multiplier: 1.0 };
  }
  if (total >= 13 * 60 + 30 && total <= 15 * 60 + 30) {
    return { name: "Late Session", multiplier: 0.92 };
  }
  return { name: "Off Session", multiplier: 0.85 };
};

const roundDownToStep = (value: number, step: number) => Math.floor(value / step) * step;
const roundUpToStep = (value: number, step: number) => Math.ceil(value / step) * step;

export default function PcrTableClient({
  instrumentKey,
  title = "Nifty Live PCR"
}: {
  instrumentKey?: string;
  title?: string;
}) {
  const [data, setData] = useState<PcrResponse | null>(null);
  const [historyRows, setHistoryRows] = useState<DisplayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [pcr3mSeries, setPcr3mSeries] = useState<PcrSamplePoint[]>([]);
  const [pcr5mSeries, setPcr5mSeries] = useState<PcrSamplePoint[]>([]);
  const last3mSampleAtRef = useRef<number | null>(null);
  const last5mSampleAtRef = useRef<number | null>(null);
  const lastTopKeyRef = useRef<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    try {
      const url = new URL("/api/nifty/pcr", window.location.origin);
      if (instrumentKey) url.searchParams.set("instrument_key", instrumentKey);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const next = await res.json();
      if (!res.ok) throw new Error(next?.error || "Failed to load PCR");
      setData(next);
      setHistoryRows((prev) => mergeIncomingRows(prev, next?.records || []));
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load PCR");
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!historyRows.length) return;
    const latestItem = historyRows[historyRows.length - 1];
    const latestPcr = toNumeric(latestItem.row[TREND_SOURCE]);
    if (latestPcr === null) return;

    const appendSample = (
      setter: React.Dispatch<React.SetStateAction<PcrSamplePoint[]>>,
      at: number,
      value: number
    ) =>
      setter((prev) => [...prev, { at, value }].slice(-MAX_PCR_SAMPLES));

    const currentAt = latestItem.seenAt;
    if (last3mSampleAtRef.current === null) {
      appendSample(setPcr3mSeries, currentAt, latestPcr);
      last3mSampleAtRef.current = currentAt;
    } else if (currentAt - last3mSampleAtRef.current >= THREE_MIN_MS) {
      appendSample(setPcr3mSeries, currentAt, latestPcr);
      last3mSampleAtRef.current = currentAt;
    }

    if (last5mSampleAtRef.current === null) {
      appendSample(setPcr5mSeries, currentAt, latestPcr);
      last5mSampleAtRef.current = currentAt;
    } else if (currentAt - last5mSampleAtRef.current >= FIVE_MIN_MS) {
      appendSample(setPcr5mSeries, currentAt, latestPcr);
      last5mSampleAtRef.current = currentAt;
    }
  }, [historyRows]);

  const orderedRows = useMemo(() => {
    if (!historyRows.length) return [];
    // Render latest first for table and signals.
    return historyRows.slice(-MAX_ROWS).map((item) => item.row).reverse();
  }, [historyRows]);

  const pcrTrendViews = useMemo((): { trend3m: TrendView; trend5m: TrendView } | null => {
    if (!historyRows.length) return null;

    const strike = data?.signals?.buildUpStrike ?? null;
    const buildTrendView = (series: PcrSamplePoint[], label: "3m" | "5m"): TrendView => {
      if (series.length < 2) {
        return {
          tone: "neutral",
          title: `${label.toUpperCase()} TREND PENDING`,
          subtitle: `Need at least 2 samples from ${label.toUpperCase()} PCR array`,
          trail: formatPcrTrail(series.map((point) => point.value).slice(-5)),
          latest: series[series.length - 1]?.value ?? null,
          slope: 0,
          windowLabel: label
        };
      }

      const oldestToLatest = series.map((point) => point.value);

      let upSteps = 0;
      let downSteps = 0;
      for (let i = 1; i < oldestToLatest.length; i += 1) {
        const delta = oldestToLatest[i] - oldestToLatest[i - 1];
        if (delta >= 0.01) upSteps += 1;
        if (delta <= -0.01) downSteps += 1;
      }

      const latest = oldestToLatest[oldestToLatest.length - 1];
      const oldest = oldestToLatest[0];
      const slope = latest - oldest;
      const peak = Math.max(...oldestToLatest);
      const peakToLatestDrop = latest - peak;
      const trough = Math.min(...oldestToLatest);
      const troughToLatestRise = latest - trough;
      const highZoneDropThreshold = -0.1;
      const lowZoneRiseThreshold = 0.1;
      const momentumThreshold = label === "3m" ? 0.08 : 0.1;
      const neutralSlopeBuffer = 0.06;
      const nearMonotonicUp = upSteps >= oldestToLatest.length - 2;
      const nearMonotonicDown = downSteps >= oldestToLatest.length - 2;
      let recentUpStreak = 0;
      let recentDownStreak = 0;
      for (let i = oldestToLatest.length - 1; i > 0; i -= 1) {
        const delta = oldestToLatest[i] - oldestToLatest[i - 1];
        if (delta >= 0.01 && recentDownStreak === 0) {
          recentUpStreak += 1;
          continue;
        }
        if (delta <= -0.01 && recentUpStreak === 0) {
          recentDownStreak += 1;
          continue;
        }
        break;
      }
      const reversalConfirmedUp = nearMonotonicUp && recentUpStreak >= 2;
      const reversalConfirmedDown = nearMonotonicDown && recentDownStreak >= 2;

      if (latest <= 0.75) {
        if (troughToLatestRise >= lowZoneRiseThreshold) {
          return {
            tone: "bullish",
            title: "BULLISH RISK",
            subtitle: `PCR rising from low zone (${label} array, trough rise ${troughToLatestRise.toFixed(
              2
            )})${strike ? ` · Strike ${strike}` : ""}`,
            trail: formatTroughToLatestTrail(trough, latest),
            latest,
            slope,
            windowLabel: label
          };
        }
        return {
          tone: "bearish",
          title: "BEARISH MARKET",
          subtitle: `Bearish build-up (${label} array)${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPeakToLatestTrail(peak, latest),
          latest,
          slope,
          windowLabel: label
        };
      }

      if (latest >= 1.25) {
        if (peakToLatestDrop <= highZoneDropThreshold) {
          return {
            tone: "bearish",
            title: "BEARISH RISK",
            subtitle: `PCR falling from high zone (${label} array, peak drop ${Math.abs(
              peakToLatestDrop
            ).toFixed(2)})${strike ? ` · Strike ${strike}` : ""}`,
            trail: formatPeakToLatestTrail(peak, latest),
            latest,
            slope,
            windowLabel: label
          };
        }
        return {
          tone: "bullish",
          title: "BULLISH MARKET",
          subtitle: `Bullish build-up (${label} array)${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatTroughToLatestTrail(trough, latest),
          latest,
          slope,
          windowLabel: label
        };
      }

      if (Math.abs(slope) < neutralSlopeBuffer) {
        return {
          tone: "neutral",
          title: "NEUTRAL",
          subtitle: `Slope too small (${label} array)${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest),
          latest,
          slope,
          windowLabel: label
        };
      }

      if (slope >= momentumThreshold && nearMonotonicUp) {
        return {
          tone: "bullish",
          title: "BULLISH MARKET",
          subtitle: `PCR climbing (${label} array)${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatTroughToLatestTrail(trough, latest),
          latest,
          slope,
          windowLabel: label
        };
      }

      if (slope <= -momentumThreshold && nearMonotonicDown) {
        return {
          tone: "bearish",
          title: "BEARISH MARKET",
          subtitle: `PCR weakening (${label} array)${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPeakToLatestTrail(peak, latest),
          latest,
          slope,
          windowLabel: label
        };
      }

      return {
        tone: "neutral",
        title: "NEUTRAL",
        subtitle: `No strong direction (${label} array)${strike ? ` · Strike ${strike}` : ""}`,
        trail: formatPcrTrail(oldestToLatest),
        latest,
        slope,
        windowLabel: label
      };
    };

    return {
      trend3m: buildTrendView(pcr3mSeries, "3m"),
      trend5m: buildTrendView(pcr5mSeries, "5m")
    };
  }, [historyRows, data?.signals?.buildUpStrike, pcr3mSeries, pcr5mSeries]);

  const currentPcrView = useMemo(() => {
    const latest = orderedRows[0];
    const latestPcr = latest ? toNumeric(latest["Current All OI PCR"]) : null;
    const hasBackendText =
      !!data?.signals?.pcrSignal?.trim() || !!data?.signals?.buildUpSignal?.trim();

    if (hasBackendText && data?.signals) {
      return {
        tone: data.signals.pcrTone,
        title: data.signals.pcrSignal,
        subtitle: `${data.signals.buildUpSignal || "Live signal"}${
          data.signals.buildUpStrike ? ` · Strike ${data.signals.buildUpStrike}` : ""
        }`
      };
    }

    if (latestPcr === null) return null;
    const tone = latestPcr >= 1.25 ? "bullish" : latestPcr <= 0.75 ? "bearish" : "neutral";
    const title =
      tone === "bullish" ? "BULLISH BIAS" : tone === "bearish" ? "BEARISH BIAS" : "NEUTRAL BIAS";
    return {
      tone,
      title,
      subtitle: `Current All OI PCR ${latestPcr.toFixed(2)}`
    };
  }, [orderedRows, data?.signals]);

  const analyticsView = useMemo(() => {
    if (!orderedRows.length || !pcrTrendViews) return null;
    const latestRow = orderedRows[0];
    const latestAllPcr = toNumeric(latestRow[TREND_SOURCE]);
    const peChg = parseCompactVolume(latestRow["PE OI Change (±2)"]) ?? 0;
    const ceChg = parseCompactVolume(latestRow["CE OI Change (±2)"]) ?? 0;
    const oiDiff = peChg - ceChg;
    const oiBalance =
      peChg !== 0 && ceChg !== 0 ? Math.abs(peChg) / Math.max(1, Math.abs(ceChg)) : 1;
    const isBullishOiFlow = oiDiff > 0;
    const isBearishOiFlow = oiDiff < 0;
    const hasClearOiImbalance = oiBalance >= 1.15;

    const trend3 = pcrTrendViews.trend3m;
    const trend5 = pcrTrendViews.trend5m;
    const trendAlignedBullish = trend3.tone === "bullish" && trend5.tone === "bullish";
    const trendAlignedBearish = trend3.tone === "bearish" && trend5.tone === "bearish";
    const trendConflict = trend3.tone !== trend5.tone;

    let score = 50;

    if (trendAlignedBullish) score += 22;
    if (trendAlignedBearish) score -= 22;
    if (trendConflict) score += 0;

    if (latestAllPcr !== null) {
      if (latestAllPcr >= 1.25) score += 10;
      if (latestAllPcr <= 0.75) score -= 10;
    }

    if (hasClearOiImbalance && isBullishOiFlow) score += 10;
    if (hasClearOiImbalance && isBearishOiFlow) score -= 10;

    const buildSignal = data?.signals?.buildUpSignal?.toLowerCase() || "";
    if (buildSignal.includes("bullish")) score += 8;
    if (buildSignal.includes("bearish")) score -= 8;

    const vwapSignal = (data?.vwapSignal || "").toLowerCase();
    if (vwapSignal.includes("above")) score += 8;
    if (vwapSignal.includes("below")) score -= 8;

    const session = getIstSessionPhase();
    score = Math.round(Math.max(0, Math.min(100, score * session.multiplier)));

    const pcrPoints = historyRows
      .map((item) => toNumeric(item.row[TREND_SOURCE]))
      .filter((v): v is number => v !== null);
    const recentPoints = pcrPoints.slice(-20);
    const range =
      recentPoints.length > 1
        ? Math.max(...recentPoints) - Math.min(...recentPoints)
        : 0;
    let up = 0;
    let down = 0;
    for (let i = 1; i < recentPoints.length; i += 1) {
      if (recentPoints[i] > recentPoints[i - 1]) up += 1;
      if (recentPoints[i] < recentPoints[i - 1]) down += 1;
    }
    const steps = Math.max(1, recentPoints.length - 1);
    const consistency = Math.max(up, down) / steps;
    const netSlope =
      recentPoints.length >= 2 ? recentPoints[recentPoints.length - 1] - recentPoints[0] : 0;

    let regime: "Trending" | "Rangebound" | "Volatile/Choppy" | "Balanced" = "Balanced";
    if (range < 0.08) regime = "Rangebound";
    else if (range > 0.22 && consistency < 0.6) regime = "Volatile/Choppy";
    else if (Math.abs(netSlope) >= 0.12 && consistency >= 0.7) regime = "Trending";

    const divergenceAlerts: string[] = [];
    if ((latestAllPcr ?? 0) >= 1.25 && trend5.slope <= -0.2) {
      divergenceAlerts.push("High PCR but falling fast: bullish exhaustion risk.");
    }
    if ((latestAllPcr ?? 2) <= 0.75 && trend5.slope >= 0.12) {
      divergenceAlerts.push("Low PCR but rising: bearish exhaustion / reversal watch.");
    }
    if (trendConflict) {
      divergenceAlerts.push("3m and 5m trends are conflicting: wait for confirmation.");
    }

    const direction: "BULLISH" | "BEARISH" | "NO TRADE" =
      score >= 62 ? "BULLISH" : score <= 38 ? "BEARISH" : "NO TRADE";
    const entryReady =
      direction !== "NO TRADE" &&
      regime !== "Volatile/Choppy" &&
      ((direction === "BULLISH" && trend3.tone === "bullish") ||
        (direction === "BEARISH" && trend3.tone === "bearish"));
    const confirmed =
      entryReady &&
      ((direction === "BULLISH" && trend5.tone === "bullish") ||
        (direction === "BEARISH" && trend5.tone === "bearish")) &&
      !trendConflict;
    const exitWarning =
      direction === "BULLISH"
        ? trend3.tone === "bearish" || score < 50
        : direction === "BEARISH"
          ? trend3.tone === "bullish" || score > 50
          : false;
    const checklistReady =
      direction !== "NO TRADE" && entryReady && confirmed && !trendConflict && regime !== "Volatile/Choppy";
    let entryWindowStatus: "OPEN" | "CAUTION" | "AVOID" = "AVOID";
    let entryWindowReason = "Wait for cleaner setup.";
    if (session.name === "Trend Window" && checklistReady) {
      entryWindowStatus = "OPEN";
      entryWindowReason = "Stable session with aligned 3m/5m confirmation.";
    } else if (session.name === "Trend Window") {
      entryWindowStatus = "CAUTION";
      entryWindowReason = "Time window is good, but checklist is not fully aligned.";
    } else if (session.name === "Late Session" && checklistReady) {
      entryWindowStatus = "CAUTION";
      entryWindowReason = "Late session can work, but prefer smaller size and tighter risk.";
    } else if (session.name === "Opening Drive") {
      entryWindowStatus = "AVOID";
      entryWindowReason = "Opening period is noisy. Wait for structure to settle.";
    } else {
      entryWindowStatus = "AVOID";
      entryWindowReason = "Outside optimal trading window for this model.";
    }

    const underlying = typeof data?.underlying === "number" ? data.underlying : null;
    let sellStrikePlan: {
      strategy: "BULL PUT SPREAD" | "BEAR CALL SPREAD";
      side: "PE SELL" | "CE SELL";
      strike: number;
      hedgeSide: "PE BUY HEDGE" | "CE BUY HEDGE";
      hedgeStrike: number;
      safety: "LOW" | "MEDIUM" | "HIGH";
    } | null = null;

    if (confirmed && underlying !== null) {
      if (direction === "BULLISH") {
        const sellStrike = roundDownToStep(underlying - OTM_OFFSET_POINTS, DEFAULT_STRIKE_STEP);
        const hedgeStrike = roundDownToStep(sellStrike - HEDGE_OFFSET_POINTS, DEFAULT_STRIKE_STEP);
        const distance = underlying - sellStrike;
        const distancePct = (distance / Math.max(1, underlying)) * 100;
        const safety = distancePct >= 1.4 ? "HIGH" : distancePct >= 0.9 ? "MEDIUM" : "LOW";
        sellStrikePlan = {
          strategy: "BULL PUT SPREAD",
          side: "PE SELL",
          strike: sellStrike,
          hedgeSide: "PE BUY HEDGE",
          hedgeStrike,
          safety
        };
      } else if (direction === "BEARISH") {
        const sellStrike = roundUpToStep(underlying + OTM_OFFSET_POINTS, DEFAULT_STRIKE_STEP);
        const hedgeStrike = roundUpToStep(sellStrike + HEDGE_OFFSET_POINTS, DEFAULT_STRIKE_STEP);
        const distance = sellStrike - underlying;
        const distancePct = (distance / Math.max(1, underlying)) * 100;
        const safety = distancePct >= 1.4 ? "HIGH" : distancePct >= 0.9 ? "MEDIUM" : "LOW";
        sellStrikePlan = {
          strategy: "BEAR CALL SPREAD",
          side: "CE SELL",
          strike: sellStrike,
          hedgeSide: "CE BUY HEDGE",
          hedgeStrike,
          safety
        };
      }
    }

    return {
      score,
      regime,
      direction,
      entryReady,
      confirmed,
      exitWarning,
      trendConflict,
      divergenceAlerts,
      sessionName: session.name,
      oiSummary: `${formatVolume(peChg)} vs ${formatVolume(ceChg)}`,
      sellStrikePlan,
      entryWindowStatus,
      entryWindowReason
    };
  }, [orderedRows, pcrTrendViews, data?.signals?.buildUpSignal, data?.vwapSignal, historyRows]);

  const [signalJournal, setSignalJournal] = useState<JournalEntry[]>([]);
  const lastJournalKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!analyticsView || analyticsView.direction === "NO TRADE") return;
    const direction = analyticsView.direction as "BULLISH" | "BEARISH";
    const key = `${analyticsView.direction}|${analyticsView.score}|${analyticsView.regime}`;
    if (lastJournalKeyRef.current === key) return;
    lastJournalKeyRef.current = key;

    const reason = `${analyticsView.regime} · ${analyticsView.entryReady ? "entry-ready" : "setup"} · ${
      analyticsView.confirmed ? "confirmed" : "pending"
    }`;
    const at = new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: true
    });

    setSignalJournal((prev) =>
      [{ id: `${Date.now()}-${key}`, at, direction, score: analyticsView.score, reason }, ...prev].slice(
        0,
        MAX_JOURNAL_ROWS
      )
    );
  }, [analyticsView]);

  useEffect(() => {
    if (!orderedRows.length) return;
    const topKey = buildRowKey(orderedRows[0]);
    const lastTopKey = lastTopKeyRef.current;

    if (lastTopKey && topKey !== lastTopKey) {
      setFlashKey(topKey);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        setFlashKey(null);
      }, 2000);
    }

    lastTopKeyRef.current = topKey;
  }, [orderedRows]);

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!data) {
    return (
      <div className="table-loader">
        <div className="spinner" />
        <div className="loader-text">Loading PCR...</div>
      </div>
    );
  }

  return (
    <section className="pcr">
      <div className="pcr-header">
        <div>
          <div className="eyebrow">{title}</div>
          <h2>Live PCR Table</h2>
        </div>
        <div className="pcr-signals">
          {currentPcrView && (
            <div className={`sentiment right ${currentPcrView.tone}`}>
              <span>{currentPcrView.title}</span>
              <small>{currentPcrView.subtitle}</small>
            </div>
          )}
          {pcrTrendViews?.trend3m && (
            <div className={`sentiment ${pcrTrendViews.trend3m.tone}`}>
              <span>3M: {pcrTrendViews.trend3m.title}</span>
              <small>{pcrTrendViews.trend3m.subtitle}</small>
              <small className="trend-trail">{pcrTrendViews.trend3m.trail}</small>
            </div>
          )}
          {pcrTrendViews?.trend5m && (
            <div className={`sentiment ${pcrTrendViews.trend5m.tone}`}>
              <span>5M: {pcrTrendViews.trend5m.title}</span>
              <small>{pcrTrendViews.trend5m.subtitle}</small>
              <small className="trend-trail">{pcrTrendViews.trend5m.trail}</small>
            </div>
          )}
        </div>
      </div>
      {analyticsView && (
        <div className="pcr-intel-grid">
          <div className="pcr-intel-card">
            <div className="intel-head">
              <span>Best Entry Window</span>
              <span
                className={`intel-badge ${
                  analyticsView.entryWindowStatus === "OPEN"
                    ? "bullish"
                    : analyticsView.entryWindowStatus === "CAUTION"
                      ? "neutral"
                      : "bearish"
                }`}
              >
                {analyticsView.entryWindowStatus}
              </span>
            </div>
            <p className="journal-empty">{analyticsView.entryWindowReason}</p>
            <div className="intel-score-row">
              <div className="intel-score">
                <strong>{analyticsView.score}</strong>
                <small>/100</small>
              </div>
              <div className="intel-meta">
                <div>
                  <span>Direction</span>
                  <b>{analyticsView.direction}</b>
                </div>
                <div><span>Regime</span><b>{analyticsView.regime}</b></div>
                <div><span>Session</span><b>{analyticsView.sessionName}</b></div>
                <div><span>OI Flow PE/CE</span><b>{analyticsView.oiSummary}</b></div>
              </div>
            </div>
          </div>

          <div className="pcr-intel-card">
            <div className="intel-head">
              <span>Trade Checklist</span>
            </div>
            <div className="check-list">
              <div className={analyticsView.entryReady ? "ok" : "wait"}>
                {analyticsView.entryReady ? "PASS" : "WAIT"} Setup Ready (3m + score + regime)
              </div>
              <div className={analyticsView.confirmed ? "ok" : "wait"}>
                {analyticsView.confirmed ? "PASS" : "WAIT"} Trend Confirmed (5m aligned)
              </div>
              <div className={analyticsView.exitWarning ? "warn" : "ok"}>
                {analyticsView.exitWarning ? "CAUTION" : "HOLD"} Exit Signal Check
              </div>
            </div>
            {analyticsView.divergenceAlerts.length > 0 && (
              <div className="intel-alerts">
                {analyticsView.divergenceAlerts.map((alert, idx) => (
                  <p key={`${alert}-${idx}`}>{alert}</p>
                ))}
              </div>
            )}
          </div>

          <div className="pcr-intel-card journal">
            <div className="intel-head">
              <span>Signal Journal</span>
            </div>
            {signalJournal.length === 0 ? (
              <p className="journal-empty">No directional signal logged yet.</p>
            ) : (
              <div className="journal-list">
                {signalJournal.map((entry) => (
                  <div key={entry.id} className="journal-row">
                    <span className="time">{entry.at}</span>
                    <span className={entry.direction === "BULLISH" ? "dir bullish" : "dir bearish"}>
                      {entry.direction}
                    </span>
                    <span className="score">Score {entry.score}</span>
                    <span className="reason">{entry.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pcr-intel-card">
            <div className="intel-head">
              <span>Suggested Selling Strike</span>
            </div>
            {analyticsView.sellStrikePlan ? (
              <div className="strike-plan">
                <div className="row">
                  <small>Strategy</small>
                  <b>{analyticsView.sellStrikePlan.strategy}</b>
                </div>
                <div className="row">
                  <b>{analyticsView.sellStrikePlan.side}</b>
                  <span>{analyticsView.sellStrikePlan.strike}</span>
                </div>
                <div className="row">
                  <small>{analyticsView.sellStrikePlan.hedgeSide}</small>
                  <span>{analyticsView.sellStrikePlan.hedgeStrike}</span>
                </div>
                <div className="row">
                  <small>Relative Safety</small>
                  <span
                    className={`safe-pill ${
                      analyticsView.sellStrikePlan.safety === "HIGH"
                        ? "high"
                        : analyticsView.sellStrikePlan.safety === "MEDIUM"
                          ? "medium"
                          : "low"
                    }`}
                  >
                    {analyticsView.sellStrikePlan.safety}
                  </span>
                </div>
                <p className="disclaimer">
                  For intraday guidance only. Re-check if trend flips or score weakens.
                </p>
              </div>
            ) : (
              <p className="journal-empty">
                No confirmed setup yet. Strike suggestion appears only after 3m+5m confirmation.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="chain">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row, i) => {
              const rowKey = buildRowKey(row);
              const isTop = i === 0;
              const isFlash = isTop && flashKey === rowKey;
              const rowClass = isFlash ? "row-atm row-new" : isTop ? "row-atm" : "";

              return (
                <tr key={rowKey} className={rowClass}>
                {headers.map((h) => (
                  <td key={h}>
                    {typeof row[h] === "number" && !isRatioColumn(h)
                      ? formatVolume(row[h] as number)
                      : row[h] ?? "-"}
                  </td>
                ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
