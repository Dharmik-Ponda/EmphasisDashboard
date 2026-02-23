"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PcrRecord = Record<string, string | number>;
type DisplayRow = {
  key: string;
  seenAt: number;
  row: PcrRecord;
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
    pcrTone: "bullish" | "bearish" | "neutral";
    buildUpSignal: string;
    buildUpStrike?: number | null;
  };
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
const MAX_ROWS = 5;
const HISTORY_MAX_ROWS = 10000;
const THREE_MIN_MS = 3 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const TREND_SOURCE = "ALL Change OI PCR";

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

  const orderedRows = useMemo(() => {
    if (!historyRows.length) return [];
    // Render latest first for table and signals.
    return historyRows.slice(-MAX_ROWS).map((item) => item.row).reverse();
  }, [historyRows]);

  const pcrTrendViews = useMemo(() => {
    if (!historyRows.length) return null;

    // Trend source fixed as requested: ALL Change OI PCR across the session/day.
    const withPcr = historyRows
      .map((item) => ({
        seenAt: item.seenAt,
        value: toNumeric(item.row[TREND_SOURCE])
      }))
      .filter((item): item is { seenAt: number; value: number } => item.value !== null);

    const strike = data?.signals?.buildUpStrike ?? null;
    const trendTrail = withPcr.length ? formatPcrTrail(withPcr.map((p) => p.value).slice(-5)) : "-";

    const buildTrendView = (requestedWindowMs: number, label: "3m" | "5m") => {
      if (withPcr.length < 2) {
        return {
          tone: "neutral" as const,
          title: `${label.toUpperCase()} TREND PENDING`,
          subtitle: `Need at least 2 ticks (${TREND_SOURCE})`,
          trail: trendTrail
        };
      }

      const latestPoint = withPcr[withPcr.length - 1];
      const targetTime = latestPoint.seenAt - requestedWindowMs;
      const baselinePoint =
        [...withPcr].reverse().find((point) => point.seenAt <= targetTime) || withPcr[0];
      const windowMs = Math.max(1, latestPoint.seenAt - baselinePoint.seenAt);
      const windowMin = windowMs / 60000;
      const suffix = windowMin >= requestedWindowMs / 60000 - 0.5 ? label : `${windowMin.toFixed(1)}m`;
      const oldestToLatest = withPcr
        .filter((point) => point.seenAt >= baselinePoint.seenAt)
        .map((point) => point.value);

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
      const highZoneDropThreshold = label === "3m" ? -0.12 : -0.2;
      const lowZoneRiseThreshold = label === "3m" ? 0.1 : 0.12;
      const momentumThreshold = label === "3m" ? 0.08 : 0.1;
      const nearMonotonicUp = upSteps >= oldestToLatest.length - 2;
      const nearMonotonicDown = downSteps >= oldestToLatest.length - 2;

      if (latest <= 0.75) {
        if (slope >= lowZoneRiseThreshold && nearMonotonicUp) {
          return {
            tone: "bullish" as const,
            title: "REVERSAL WATCH",
            subtitle: `PCR rising from bearish zone (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
            trail: formatPcrTrail(oldestToLatest)
          };
        }
        return {
          tone: "bearish" as const,
          title: "BEARISH MARKET",
          subtitle: `Bearish build-up (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest)
        };
      }

      if (latest >= 1.25) {
        if (slope <= highZoneDropThreshold) {
          return {
            tone: "bearish" as const,
            title: "BEARISH RISK",
            subtitle: `PCR falling from high zone (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
            trail: formatPcrTrail(oldestToLatest)
          };
        }
        return {
          tone: "bullish" as const,
          title: "BULLISH MARKET",
          subtitle: `Bullish build-up (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest)
        };
      }

      if (slope >= momentumThreshold && nearMonotonicUp) {
        return {
          tone: "bullish" as const,
          title: "BULLISH MOMENTUM",
          subtitle: `PCR climbing (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest)
        };
      }

      if (slope <= -momentumThreshold && nearMonotonicDown) {
        return {
          tone: "bearish" as const,
          title: "BEARISH MOMENTUM",
          subtitle: `PCR weakening (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest)
        };
      }

      return {
        tone: "neutral" as const,
        title: "SIDEWAYS PCR",
        subtitle: `No strong direction (${suffix})${strike ? ` · Strike ${strike}` : ""}`,
        trail: formatPcrTrail(oldestToLatest)
      };
    };

    return {
      trend3m: buildTrendView(THREE_MIN_MS, "3m"),
      trend5m: buildTrendView(FIVE_MIN_MS, "5m")
    };
  }, [historyRows, data?.signals?.buildUpStrike]);

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
