"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PcrRecord = Record<string, string | number>;
type DisplayRow = {
  key: string;
  seenAt: number;
  row: PcrRecord;
};
type Tone = "bullish" | "bearish" | "neutral";
type PcrWindowLabel = "3m" | "5m";
type PcrAnalysis = {
  windowLabel: PcrWindowLabel;
  status: "ready" | "pending";
  tone: Tone;
  title: string;
  subtitle: string;
  updatedAtLabel: string | null;
  pcr: number | null;
  previous: number | null;
  delta: number;
  pcrDeltaLabel: string;
  momentum: string;
  trend: string;
  regime: string;
  signal: string;
  bias: string;
  score: number;
  bearScore: number;
  ma: number | null;
  mid: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  sampleCount: number;
  oiIncreaseLabel: string;
  oiDecreaseLabel: string;
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
type IntervalSnapshot = {
  at: number;
  row: PcrRecord;
};

type PcrResponse = {
  records: PcrRecord[];
  sentiment: { label: string; tone: "bullish" | "bearish" | "neutral" };
  trend: string;
  peBuildUp?: { strike: number | null; oiChange: number };
  peBuildUpSecondary?: { strike: number | null; oiChange: number };
  peReduction?: { strike: number | null; oiChange: number };
  ceBuildUp?: { strike: number | null; oiChange: number };
  ceBuildUpSecondary?: { strike: number | null; oiChange: number };
  ceReduction?: { strike: number | null; oiChange: number };
  signals?: {
    pcrSignal: string;
    pcrTone: Tone;
    buildUpSignal: string;
    buildUpStrike?: number | null;
    buildUpSecondaryStrike?: number | null;
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
const pcrHeaders = headers.filter((header) => header.includes("PCR"));
const pcrHeaderSet = new Set(pcrHeaders);
const signedOiHeaders = new Set([
  "PE Total OI Change",
  "CE Total OI Change",
  "PE OI Change (±2)",
  "CE OI Change (±2)"
]);

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

const getPcrValue = (row: PcrRecord, header: string) => {
  const value = toNumeric(row[header]);
  if (value === null) return null;
  return pcrHeaderSet.has(header) ? Math.max(0, value) : value;
};

const normalizePcrRecord = (row: PcrRecord): PcrRecord => {
  const normalized: PcrRecord = { ...row };
  for (const header of pcrHeaders) {
    const value = getPcrValue(row, header);
    if (value !== null) normalized[header] = +value.toFixed(2);
  }
  return normalized;
};

const MAX_ROWS = 5;
const HISTORY_MAX_ROWS = 2000;
const PCR_HISTORY_STORAGE_PREFIX = "pcr-history";
const THREE_MIN_MS = 3 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const TREND_SOURCE = "ALL Change OI PCR";
const MAX_JOURNAL_ROWS = 14;
const DEFAULT_STRIKE_STEP = 50;
const OTM_OFFSET_POINTS = 250;
const HEDGE_OFFSET_POINTS = 200;
const ITM_CALENDAR_OFFSET_POINTS = 100;
const PCR_VIEW_FLIP_DELTA = 0.1;

const mergeIncomingRows = (previousRows: DisplayRow[], incomingRecords: PcrRecord[]) => {
  if (!incomingRecords.length) return previousRows;

  // API records are oldest -> latest; preserve that and only append unseen rows.
  const incomingOrdered = incomingRecords.slice(-HISTORY_MAX_ROWS);
  const previousKeys = new Set(previousRows.map((item) => item.key));
  const merged = [...previousRows];
  const now = Date.now();
  let offsetMs = 0;

  const parseIstTimeToEpoch = (raw: unknown): number | null => {
    if (typeof raw !== "string") return null;
    const match = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3]);
    const meridiem = match[4].toLowerCase();
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const year = dateParts.find((p) => p.type === "year")?.value;
    const month = dateParts.find((p) => p.type === "month")?.value;
    const day = dateParts.find((p) => p.type === "day")?.value;
    if (!year || !month || !day) return null;

    const iso = `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}:${String(second).padStart(2, "0")}+05:30`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : null;
  };

  for (const row of incomingOrdered) {
    const normalizedRow = normalizePcrRecord(row);
    const key = buildRowKey(normalizedRow);
    if (previousKeys.has(key)) continue;
    previousKeys.add(key);
    const parsedAt = parseIstTimeToEpoch(normalizedRow.Time);
    merged.push({
      key,
      row: normalizedRow,
      seenAt: parsedAt ?? now + offsetMs
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

const formatSignedDelta = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

const buildIntervalSnapshots = (
  rows: DisplayRow[],
  intervalMs: number,
  nowMs: number = Date.now()
): IntervalSnapshot[] => {
  const buckets = new Map<number, IntervalSnapshot>();
  const activeBucketStart = Math.floor(nowMs / intervalMs) * intervalMs;

  for (const item of rows) {
    const bucketAt = Math.floor(item.seenAt / intervalMs) * intervalMs;
    if (bucketAt >= activeBucketStart) continue;
    buckets.set(bucketAt, { at: bucketAt, row: item.row });
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, snapshot]) => snapshot);
};

const getOiLeaderLabel = (row: PcrRecord, strikeKey: string, valueKey: string) => {
  const strike = String(row[strikeKey] ?? "-").trim();
  const rawValue = toNumeric(row[valueKey]);
  if (!strike || strike === "-") return "-";
  if (rawValue === null) return strike;
  return `${strike} (${formatVolume(rawValue)})`;
};

const getSignedOiCellMeta = (header: string, rawValue: unknown) => {
  if (!signedOiHeaders.has(header)) return null;
  const numeric = parseCompactVolume(rawValue);
  if (numeric === null || numeric === 0) return { className: "", title: `${header}: Flat / no net change` };
  const side = header.startsWith("PE") ? "PE" : "CE";
  const action = numeric > 0 ? "Build-up / writing added" : "Unwinding / positions reduced";
  return {
    className: numeric < 0 ? "negative" : "",
    title: `${side}: ${action}`
  };
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
const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const formatBucketTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

const buildIntervalSeries = (
  rows: DisplayRow[],
  intervalMs: number,
  nowMs: number = Date.now()
): PcrSamplePoint[] => {
  return buildIntervalSnapshots(rows, intervalMs, nowMs)
    .map((snapshot) => {
      const value = getPcrValue(snapshot.row, TREND_SOURCE);
      if (value === null) return null;
      return { at: snapshot.at, value };
    })
    .filter((point): point is PcrSamplePoint => point !== null);
};

const analyzePCR = (
  series: PcrSamplePoint[],
  snapshots: IntervalSnapshot[],
  windowLabel: PcrWindowLabel
): PcrAnalysis => {
  const latestSnapshot = snapshots[snapshots.length - 1]?.row ?? null;
  const oiIncreaseLabel = latestSnapshot
    ? getOiLeaderLabel(latestSnapshot, "Top OI Increase Strike", "Top OI Increase Value")
    : "-";
  const oiDecreaseLabel = latestSnapshot
    ? getOiLeaderLabel(latestSnapshot, "Top OI Decrease Strike", "Top OI Decrease Value")
    : "-";

  if (series.length < 2) {
    const latest = series[series.length - 1]?.value ?? null;
    return {
      windowLabel,
      status: "pending",
      tone: "neutral",
      title: `${windowLabel.toUpperCase()} PCR PENDING`,
      subtitle: "Need at least 2 aggregated PCR samples",
      updatedAtLabel: series.length ? formatBucketTime(series[series.length - 1].at) : null,
      pcr: latest,
      previous: null,
      delta: 0,
      pcrDeltaLabel: latest === null ? "-" : `${latest.toFixed(2)} -> ${latest.toFixed(2)} (${formatSignedDelta(0)})`,
      momentum: "Weak / Neutral Momentum",
      trend: "Neutral Trend",
      regime: "Range Pending",
      signal: "Neutral / Sideways Market",
      bias: "Wait or use wider spreads",
      score: 0,
      bearScore: 0,
      ma: latest,
      mid: latest,
      dayLow: latest,
      dayHigh: latest,
      sampleCount: series.length,
      oiIncreaseLabel,
      oiDecreaseLabel
    };
  }

  const values = series.map((point) => point.value);
  const current = values[values.length - 1];
  const previous = values[values.length - 2];
  const delta = current - previous;
  const ma = average(values.slice(-5)) ?? current;
  const dayLow = Math.min(...values);
  const dayHigh = Math.max(...values);
  const mid = (dayLow + dayHigh) / 2;

  const bullishMomentum = delta >= PCR_VIEW_FLIP_DELTA;
  const bearishMomentum = delta <= -PCR_VIEW_FLIP_DELTA;
  const aboveMa = current > ma;
  const belowMa = current < ma;
  const aboveMid = current > mid;
  const belowMid = current < mid;

  const momentum = bullishMomentum
    ? "Bullish Momentum"
    : bearishMomentum
      ? "Bearish Momentum"
      : "Weak / Neutral Momentum";
  const trend = aboveMa ? "Bullish Trend" : belowMa ? "Bearish Trend" : "Neutral Trend";
  const regime = aboveMid ? "Upper Range (Bullish Environment)" : "Lower Range (Bearish Environment)";

  const majorBullishShift = bullishMomentum;
  const majorBearishShift = bearishMomentum;
  const bullStrength = Number(majorBullishShift) + Number(aboveMa) + Number(aboveMid);
  const bearStrength = Number(majorBearishShift) + Number(belowMa) + Number(belowMid);
  const bullContinuationStrength = Number(delta > 0) + Number(aboveMa) + Number(aboveMid);
  const bearContinuationStrength = Number(delta < 0) + Number(belowMa) + Number(belowMid);

  let signal = "Neutral / Sideways Market";
  let bias = "Wait or use wider spreads";
  let tone: Tone = "neutral";
  let score = 0;

  if (bullStrength === 3 && bearStrength < 3) {
    signal = "Strong Bullish Pressure";
    bias = "Prefer Bull Put Spread";
    tone = "bullish";
    score = bullStrength;
  } else if (bearStrength === 3 && bullStrength < 3) {
    signal = "Strong Bearish Pressure";
    bias = "Prefer Bear Call Spread";
    tone = "bearish";
    score = bearStrength;
  } else if (bullContinuationStrength >= 2 && bearContinuationStrength < 2) {
    signal = "Bullish Trend Continuation";
    bias = "Trend intact, prefer Bull Put Spread on dips";
    tone = "bullish";
    score = 2;
  } else if (bearContinuationStrength >= 2 && bullContinuationStrength < 2) {
    signal = "Bearish Trend Continuation";
    bias = "Trend intact, prefer Bear Call Spread on pullbacks";
    tone = "bearish";
    score = 2;
  } else if (bullContinuationStrength === 1 && bearContinuationStrength === 0) {
    signal = "Bullish Risk";
    bias = "Bullish setup is weak. Wait for confirmation.";
    tone = "neutral";
    score = 1;
  } else if (bearContinuationStrength === 1 && bullContinuationStrength === 0) {
    signal = "Bearish Risk";
    bias = "Bearish setup is weak. Wait for confirmation.";
    tone = "neutral";
    score = 1;
  }

  const bearScore = bearStrength;

  return {
    windowLabel,
    status: "ready",
    tone,
    title: signal,
    subtitle: `${momentum} · ${trend}`,
    updatedAtLabel: formatBucketTime(series[series.length - 1].at),
    pcr: current,
    previous,
    delta,
    pcrDeltaLabel: `${previous.toFixed(2)} -> ${current.toFixed(2)} (${formatSignedDelta(delta)})`,
    momentum,
    trend,
    regime,
    signal,
    bias,
    score,
    bearScore,
    ma,
    mid,
    dayLow,
    dayHigh,
    sampleCount: series.length,
    oiIncreaseLabel,
    oiDecreaseLabel
  };
};

const getIstDateParts = () => {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = dateParts.find((p) => p.type === "year")?.value;
  const month = dateParts.find((p) => p.type === "month")?.value;
  const day = dateParts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return { year, month, day };
};

const getIstSessionBounds = () => {
  const parts = getIstDateParts();
  if (!parts) return null;
  const start = Date.parse(`${parts.year}-${parts.month}-${parts.day}T09:15:00+05:30`);
  const end = Date.parse(`${parts.year}-${parts.month}-${parts.day}T15:30:00+05:30`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
};

const sanitizeRowsForSession = (rows: DisplayRow[]) => {
  const bounds = getIstSessionBounds();
  if (!bounds) {
    return rows
      .map((item) => ({ ...item, row: normalizePcrRecord(item.row) }))
      .slice(-HISTORY_MAX_ROWS);
  }
  return rows
    .map((item) => ({ ...item, row: normalizePcrRecord(item.row) }))
    .filter((item) => item.seenAt >= bounds.start && item.seenAt <= bounds.end)
    .slice(-HISTORY_MAX_ROWS);
};

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
      setHistoryRows((prev) => sanitizeRowsForSession(mergeIncomingRows(prev, next?.records || [])));
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load PCR");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bounds = getIstSessionBounds();
    if (!bounds) return;
    const storageKey = `${PCR_HISTORY_STORAGE_PREFIX}:${instrumentKey || "default"}:${bounds.dateKey}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as DisplayRow[];
      if (!Array.isArray(parsed)) return;
      const valid = sanitizeRowsForSession(
        parsed.filter(
          (item) =>
            item &&
            typeof item.key === "string" &&
            typeof item.seenAt === "number" &&
            item.row &&
            typeof item.row === "object"
        )
      );
      if (valid.length) setHistoryRows(valid);
    } catch {
      // ignore malformed local cache
    }
  }, [instrumentKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bounds = getIstSessionBounds();
    if (!bounds) return;
    const storageKey = `${PCR_HISTORY_STORAGE_PREFIX}:${instrumentKey || "default"}:${bounds.dateKey}`;
    const rowsToPersist = sanitizeRowsForSession(historyRows);
    try {
      if (!rowsToPersist.length) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, JSON.stringify(rowsToPersist));
      }
    } catch {
      // ignore localStorage quota / private mode errors
    }
  }, [historyRows, instrumentKey]);

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

  const responseRows = useMemo(() => mergeIncomingRows([], data?.records || []), [data?.records]);
  const effectiveRows = historyRows.length ? historyRows : responseRows;

  const orderedRows = useMemo(() => {
    if (!effectiveRows.length) return [];
    // Render latest first for table and signals.
    return effectiveRows.slice(-MAX_ROWS).map((item) => item.row).reverse();
  }, [effectiveRows]);

  const pcrExtremes = useMemo(() => {
    const extremes: Record<string, { high: number | null; low: number | null }> = {};
    for (const header of pcrHeaders) {
      extremes[header] = { high: null, low: null };
    }

    for (const item of effectiveRows) {
      for (const header of pcrHeaders) {
        const value = getPcrValue(item.row, header);
        if (value === null) continue;
        const current = extremes[header];
        current.high = current.high === null ? value : Math.max(current.high, value);
        current.low = current.low === null ? value : Math.min(current.low, value);
      }
    }

    return extremes;
  }, [effectiveRows]);

  const pcrTrendViews = useMemo((): { trend3m: PcrAnalysis; trend5m: PcrAnalysis } | null => {
    if (!effectiveRows.length) return null;

    const snapshots3m = buildIntervalSnapshots(effectiveRows, THREE_MIN_MS);
    const snapshots5m = buildIntervalSnapshots(effectiveRows, FIVE_MIN_MS);

    return {
      trend3m: analyzePCR(buildIntervalSeries(effectiveRows, THREE_MIN_MS), snapshots3m, "3m"),
      trend5m: analyzePCR(buildIntervalSeries(effectiveRows, FIVE_MIN_MS), snapshots5m, "5m")
    };
  }, [effectiveRows]);

  useEffect(() => {
    if (!effectiveRows.length) return;
    const threeMinute = buildIntervalSeries(effectiveRows, THREE_MIN_MS).map((p) => ({
      at: new Date(p.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }),
      value: Number(p.value.toFixed(2))
    }));
    const fiveMinute = buildIntervalSeries(effectiveRows, FIVE_MIN_MS).map((p) => ({
      at: new Date(p.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }),
      value: Number(p.value.toFixed(2))
    }));
    const fullSession = effectiveRows.map((item) => {
      const normalizedValue = getPcrValue(item.row, TREND_SOURCE);
      return {
        at: new Date(item.seenAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }),
        value: normalizedValue === null ? null : Number(normalizedValue.toFixed(2))
      };
    });
    (window as any).__pcrWindows = { threeMinute, fiveMinute };
    (window as any).__pcrSession = {
      totalPoints: fullSession.length,
      first: fullSession[0] || null,
      last: fullSession[fullSession.length - 1] || null,
      values: fullSession
    };
    console.debug("__pcrWindows", (window as any).__pcrWindows);
    console.debug("__pcrSession", {
      totalPoints: (window as any).__pcrSession.totalPoints,
      first: (window as any).__pcrSession.first,
      last: (window as any).__pcrSession.last
    });
  }, [effectiveRows]);

  const currentPcrView = useMemo(() => {
    const latest = orderedRows[0];
    const latestPcr = latest ? getPcrValue(latest, "Current All OI PCR") : null;
    const hasBackendText =
      !!data?.signals?.pcrSignal?.trim() || !!data?.signals?.buildUpSignal?.trim();

    if (hasBackendText && data?.signals) {
      const strikeSummary = [data.signals.buildUpStrike, data.signals.buildUpSecondaryStrike]
        .filter((value): value is number => typeof value === "number")
        .join(" / ");
      return {
        tone: data.signals.pcrTone,
        title: data.signals.pcrSignal,
        subtitle: `${data.signals.buildUpSignal || "Live signal"}${
          strikeSummary ? ` · Strike ${strikeSummary}` : ""
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
    const latestAllPcr = getPcrValue(latestRow, TREND_SOURCE);
    const latestFastPcr = getPcrValue(latestRow, "Current Change OI PCR");
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
    const trendConflict =
      (trend3.tone === "bullish" && trend5.tone === "bearish") ||
      (trend3.tone === "bearish" && trend5.tone === "bullish");

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

    const analyticsSourceRows = historyRows.length ? historyRows : responseRows;
    const pcrPoints = analyticsSourceRows
      .map((item) => getPcrValue(item.row, TREND_SOURCE))
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
    if ((latestAllPcr ?? 0) >= 1.25 && trend5.delta <= -PCR_VIEW_FLIP_DELTA) {
      divergenceAlerts.push("High PCR but falling fast: bullish exhaustion risk.");
    }
    if ((latestAllPcr ?? 2) <= 0.75 && trend5.delta >= PCR_VIEW_FLIP_DELTA) {
      divergenceAlerts.push("Low PCR but rising: bearish exhaustion / reversal watch.");
    }
    if (trendConflict) {
      divergenceAlerts.push("3m and 5m trends are conflicting: wait for confirmation.");
    }

    const direction: "BULLISH" | "BEARISH" | "NO TRADE" =
      score >= 62 ? "BULLISH" : score <= 38 ? "BEARISH" : "NO TRADE";
    const fastTriggerAligned =
      latestFastPcr !== null &&
      ((direction === "BULLISH" && latestFastPcr >= 1.1) ||
        (direction === "BEARISH" && latestFastPcr <= 0.9));
    const entryReady =
      direction !== "NO TRADE" &&
      fastTriggerAligned &&
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
    let itmCalendarPlan: {
      spot: number;
      direction: "BULLISH" | "BEARISH";
      strategy: "ITM CE CALENDAR" | "ITM PE CALENDAR";
      strike: number;
      optionType: "CE" | "PE";
      sellLeg: string;
      buyLeg: string;
    } | null = null;

    if (underlying !== null) {
      if (direction === "BULLISH") {
        const strike = roundDownToStep(underlying - ITM_CALENDAR_OFFSET_POINTS, DEFAULT_STRIKE_STEP);
        itmCalendarPlan = {
          spot: Math.round(underlying),
          direction,
          strategy: "ITM CE CALENDAR",
          strike,
          optionType: "CE",
          sellLeg: `Sell CE ${strike} (Current Week)`,
          buyLeg: `Buy CE ${strike} (Next Week)`
        };
      } else if (direction === "BEARISH") {
        const strike = roundUpToStep(underlying + ITM_CALENDAR_OFFSET_POINTS, DEFAULT_STRIKE_STEP);
        itmCalendarPlan = {
          spot: Math.round(underlying),
          direction,
          strategy: "ITM PE CALENDAR",
          strike,
          optionType: "PE",
          sellLeg: `Sell PE ${strike} (Current Week)`,
          buyLeg: `Buy PE ${strike} (Next Week)`
        };
      }
    }

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
      itmCalendarPlan,
      entryWindowStatus,
      entryWindowReason
    };
  }, [orderedRows, pcrTrendViews, data?.signals?.buildUpSignal, data?.vwapSignal, historyRows, responseRows]);

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
          <div className="pcr-intel-card pcr-signal-slot">
            {pcrTrendViews?.trend3m && (
              <div className={`sentiment signal-card ${pcrTrendViews.trend3m.tone}`}>
                <div className="signal-top">
                  <span className="signal-label">
                    <span>3M PCR</span>
                    {pcrTrendViews.trend3m.updatedAtLabel ? (
                      <span className="signal-updated"> (Updated {pcrTrendViews.trend3m.updatedAtLabel})</span>
                    ) : null}
                  </span>
                  <b className="signal-strength">{pcrTrendViews.trend3m.score}/3</b>
                </div>
                <strong className="signal-title">{pcrTrendViews.trend3m.signal}</strong>
                <div className="signal-detail-stack">
                  <div className="signal-detail-box compact">
                    <label>PCR / Delta</label>
                    <b className="signal-pcr-flow">
                      <span className="signal-pcr-prev">
                        {pcrTrendViews.trend3m.previous?.toFixed(2) ?? pcrTrendViews.trend3m.pcr?.toFixed(2) ?? "-"}
                      </span>
                      <span className="signal-pcr-arrow">-&gt;</span>
                      <span className="signal-pcr-current">
                        {(pcrTrendViews.trend3m.pcr?.toFixed(2) ?? "-") +
                          ` (${pcrTrendViews.trend3m.delta >= 0 ? "+" : ""}${pcrTrendViews.trend3m.delta.toFixed(2)})`}
                      </span>
                    </b>
                  </div>
                  <div className="signal-track-box">
                    <div className="signal-track-half up">
                      <label>OI Up</label>
                      <b>{pcrTrendViews.trend3m.oiIncreaseLabel}</b>
                    </div>
                    <div className="signal-track-half down">
                      <label>OI Down</label>
                      <b>{pcrTrendViews.trend3m.oiDecreaseLabel}</b>
                    </div>
                  </div>
                </div>
                <small>{pcrTrendViews.trend3m.momentum} · {pcrTrendViews.trend3m.trend}</small>
                <small>{pcrTrendViews.trend3m.regime}</small>
                <small className="signal-bias">{pcrTrendViews.trend3m.bias}</small>
              </div>
            )}
          </div>
          <div className="pcr-intel-card pcr-signal-slot">
            {pcrTrendViews?.trend5m && (
              <div className={`sentiment signal-card ${pcrTrendViews.trend5m.tone}`}>
                <div className="signal-top">
                  <span className="signal-label">
                    <span>5M PCR</span>
                    {pcrTrendViews.trend5m.updatedAtLabel ? (
                      <span className="signal-updated"> (Updated {pcrTrendViews.trend5m.updatedAtLabel})</span>
                    ) : null}
                  </span>
                  <b className="signal-strength">{pcrTrendViews.trend5m.score}/3</b>
                </div>
                <strong className="signal-title">{pcrTrendViews.trend5m.signal}</strong>
                <div className="signal-detail-stack">
                  <div className="signal-detail-box compact">
                    <label>PCR / Delta</label>
                    <b className="signal-pcr-flow">
                      <span className="signal-pcr-prev">
                        {pcrTrendViews.trend5m.previous?.toFixed(2) ?? pcrTrendViews.trend5m.pcr?.toFixed(2) ?? "-"}
                      </span>
                      <span className="signal-pcr-arrow">-&gt;</span>
                      <span className="signal-pcr-current">
                        {(pcrTrendViews.trend5m.pcr?.toFixed(2) ?? "-") +
                          ` (${pcrTrendViews.trend5m.delta >= 0 ? "+" : ""}${pcrTrendViews.trend5m.delta.toFixed(2)})`}
                      </span>
                    </b>
                  </div>
                  <div className="signal-track-box">
                    <div className="signal-track-half up">
                      <label>OI Up</label>
                      <b>{pcrTrendViews.trend5m.oiIncreaseLabel}</b>
                    </div>
                    <div className="signal-track-half down">
                      <label>OI Down</label>
                      <b>{pcrTrendViews.trend5m.oiDecreaseLabel}</b>
                    </div>
                  </div>
                </div>
                <small>{pcrTrendViews.trend5m.momentum} · {pcrTrendViews.trend5m.trend}</small>
                <small>{pcrTrendViews.trend5m.regime}</small>
                <small className="signal-bias">{pcrTrendViews.trend5m.bias}</small>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="chain">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className={h.includes("PCR") ? "pcr-col" : undefined}>
                  <span className="pcr-head-label">{h}</span>
                  {h.includes("PCR") && (
                    <span className="pcr-extremes">
                      <span className="pcr-badge high">
                        H: {pcrExtremes[h]?.high?.toFixed(2) ?? "-"}
                      </span>
                      <span className="pcr-sep">|</span>
                      <span className="pcr-badge low">
                        L: {pcrExtremes[h]?.low?.toFixed(2) ?? "-"}
                      </span>
                    </span>
                  )}
                </th>
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
                {headers.map((h) => {
                  const oiMeta = getSignedOiCellMeta(h, row[h]);
                  const className = [h.includes("PCR") ? "pcr-col" : "", oiMeta?.className || ""]
                    .filter(Boolean)
                    .join(" ");
                  const normalizedPcrValue = pcrHeaderSet.has(h) ? getPcrValue(row, h) : null;
                  const displayValue =
                    normalizedPcrValue !== null
                      ? normalizedPcrValue.toFixed(2)
                      : typeof row[h] === "number" && !isRatioColumn(h)
                      ? formatVolume(row[h] as number)
                      : row[h] ?? "-";

                  return (
                    <td key={h} className={className || undefined} title={oiMeta?.title}>
                      {displayValue}
                    </td>
                  );
                })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
