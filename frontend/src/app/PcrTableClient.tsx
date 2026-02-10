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
    return [...data.records].reverse();
  }, [data?.records]);

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
        {data.signals && (
          <div className={`sentiment right ${data.signals.pcrTone}`}>
            <span>{data.signals.pcrSignal}</span>
            <small>
              {data.signals.buildUpSignal}
              {data.signals.buildUpStrike ? ` · Strike ${data.signals.buildUpStrike}` : ""}
            </small>
          </div>
        )}
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
                <tr key={`${rowKey}-${i}`} className={rowClass}>
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
