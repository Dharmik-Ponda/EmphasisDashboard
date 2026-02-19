"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PcrRecord = Record<string, string | number>;

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

const buildRowKeyWithoutTime = (row: PcrRecord) =>
  headers
    .filter((h) => h !== "Time")
    .map((h) => String(row[h] ?? ""))
    .join("|");

const toNumeric = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatPcrTrail = (values: number[]) => values.map((v) => `|${v.toFixed(2)}|`).join(" ");

export default function PcrTableClient({
  instrumentKey,
  title = "Nifty Live PCR"
}: {
  instrumentKey?: string;
  title?: string;
}) {
  const [data, setData] = useState<PcrResponse | null>(null);
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
    if (!data?.records?.length) return [];
    const seen = new Set<string>();
    const rows: PcrRecord[] = [];
    for (const row of [...data.records].reverse()) {
      const key = buildRowKeyWithoutTime(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }, [data?.records]);

  const pcrTrendView = useMemo(() => {
    if (!orderedRows.length) return null;

    const source = "ALL Change OI PCR";
    const points = orderedRows
      .map((row) => toNumeric(row[source]))
      .filter((v): v is number => v !== null)
      .slice(0, 5);

    if (points.length < 3) {
      const latest = points[0];
      return {
        tone: "neutral" as const,
        title: "TREND PENDING",
        subtitle: "Need more ticks",
        trail: points.length ? formatPcrTrail(points.reverse()) : "-"
      };
    }

    const oldestToLatest = [...points].reverse();
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
    const nearMonotonicUp = upSteps >= oldestToLatest.length - 2;
    const nearMonotonicDown = downSteps >= oldestToLatest.length - 2;
    const strike = data?.signals?.buildUpStrike ?? null;

    if (latest <= 0.75) {
      if (slope >= 0.08 && nearMonotonicUp) {
        return {
          tone: "bullish" as const,
          title: "REVERSAL WATCH",
          subtitle: `PCR rising from bearish zone${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest)
        };
      }
      return {
        tone: "bearish" as const,
        title: "BEARISH MARKET",
        subtitle: `Bearish build-up${strike ? ` · Strike ${strike}` : ""}`,
        trail: formatPcrTrail(oldestToLatest)
      };
    }

    if (latest >= 1.25) {
      if (slope <= -0.12 && nearMonotonicDown) {
        return {
          tone: "bearish" as const,
          title: "BEARISH RISK",
          subtitle: `PCR falling from high zone${strike ? ` · Strike ${strike}` : ""}`,
          trail: formatPcrTrail(oldestToLatest)
        };
      }
      return {
        tone: "bullish" as const,
        title: "BULLISH MARKET",
        subtitle: `Bullish build-up${strike ? ` · Strike ${strike}` : ""}`,
        trail: formatPcrTrail(oldestToLatest)
      };
    }

    if (slope >= 0.08 && nearMonotonicUp) {
      return {
        tone: "bullish" as const,
        title: "BULLISH MOMENTUM",
        subtitle: `PCR climbing${strike ? ` · Strike ${strike}` : ""}`,
        trail: formatPcrTrail(oldestToLatest)
      };
    }

    if (slope <= -0.08 && nearMonotonicDown) {
      return {
        tone: "bearish" as const,
        title: "BEARISH MOMENTUM",
        subtitle: `PCR weakening${strike ? ` · Strike ${strike}` : ""}`,
        trail: formatPcrTrail(oldestToLatest)
      };
    }

    return {
      tone: "neutral" as const,
      title: "SIDEWAYS PCR",
      subtitle: `No strong direction${strike ? ` · Strike ${strike}` : ""}`,
      trail: formatPcrTrail(oldestToLatest)
    };
  }, [orderedRows, data?.signals?.buildUpStrike]);

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
    const topKey = buildRowKeyWithoutTime(orderedRows[0]);
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
          {pcrTrendView && (
            <div className={`sentiment ${pcrTrendView.tone}`}>
              <span>{pcrTrendView.title}</span>
              <small>{pcrTrendView.subtitle}</small>
              <small className="trend-trail">{pcrTrendView.trail}</small>
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
              const rowKey = buildRowKeyWithoutTime(row);
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
