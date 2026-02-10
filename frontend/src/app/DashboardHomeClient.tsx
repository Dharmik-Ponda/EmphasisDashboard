"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Card = {
  id: string;
  title: string;
  subtitle?: string;
  kind: "table" | "pie" | "donut" | "list";
  columns?: string[];
  rows?: (string | number)[][];
  legend?: { label: string; value: number; color: string }[];
  notes?: string[];
};

const numberFormat = new Intl.NumberFormat("en-IN");

const defaultCards: Card[] = [
  {
    id: "cash-gainers",
    title: "Top Gainers · Cash",
    subtitle: "6 Feb, 3:30pm",
    kind: "table",
    columns: ["Symbol", "Price", "% Chg", "Vol", "D/S"],
    rows: []
  },
  {
    id: "cash-losers",
    title: "Top Losers · Cash",
    subtitle: "6 Feb, 3:30pm",
    kind: "table",
    columns: ["Symbol", "Price", "% Chg", "Vol", "D/S"],
    rows: []
  },
  {
    id: "intraday",
    title: "Intraday Stocks · By Emphasis",
    subtitle: "6 Feb, 3:15pm candle @ 3:30pm",
    kind: "table",
    columns: ["Symbol", "Price", "% Chg", "Volume", "V Fac"],
    rows: []
  },
  {
    id: "fut-gainers",
    title: "Top Gainers · Futures",
    subtitle: "6 Feb, 3:25pm candle @ 3:30pm",
    kind: "table",
    columns: ["Symbol", "LTP", "% Chg", "V Fac", "D/S"],
    rows: []
  },
  {
    id: "fut-losers",
    title: "Top Losers · Futures",
    subtitle: "6 Feb, 3:25pm candle @ 3:30pm",
    kind: "table",
    columns: ["Symbol", "LTP", "% Chg", "V Fac", "D/S"],
    rows: []
  },
  {
    id: "demand",
    title: "Highest Demand Stocks",
    subtitle: "6 Feb, 3:30pm",
    kind: "pie",
    legend: []
  },
  {
    id: "top-buy",
    title: "Today’s Top Buying Stocks",
    subtitle: "6 Feb, 3:15pm candle @ 3:30pm",
    kind: "table",
    columns: ["Symbol", "% Gain", "Price", "Volume", "V Fac"],
    rows: []
  },
  {
    id: "sector-advance",
    title: "Sector Advance %",
    subtitle: "6 Feb, 3:30pm",
    kind: "table",
    columns: ["Sector", "Advance %"],
    rows: []
  },
  {
    id: "vwap",
    title: "Nifty 50 Stocks Above/Below VWAP",
    subtitle: "6 Feb, 3:30pm",
    kind: "donut",
    legend: []
  }
];

const STORAGE_KEY = "dashboard-card-order-v1";
const SIZE_KEY = "dashboard-card-sizes-v1";

export default function DashboardHomeClient() {
  const [cards, setCards] = useState<Card[]>(defaultCards);
  const dragId = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [savedSizes, setSavedSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [draftSizes, setDraftSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [cashGainers, setCashGainers] = useState<Card["rows"] | null>(null);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashLosers, setCashLosers] = useState<Card["rows"] | null>(null);
  const [futGainers, setFutGainers] = useState<Card["rows"] | null>(null);
  const [futLosers, setFutLosers] = useState<Card["rows"] | null>(null);
  const [intradayStocks, setIntradayStocks] = useState<Card["rows"] | null>(null);
  const [topBuy, setTopBuy] = useState<Card["rows"] | null>(null);
  const [demandLegend, setDemandLegend] = useState<Card["legend"] | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const order = JSON.parse(stored) as string[];
      const ordered = order
        .map((id) => defaultCards.find((c) => c.id === id))
        .filter(Boolean) as Card[];
      const remaining = defaultCards.filter((c) => !order.includes(c.id));
      setCards([...ordered, ...remaining]);
    } catch {
      setCards(defaultCards);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(SIZE_KEY);
    if (!stored) return;
    try {
      const sizes = JSON.parse(stored) as Record<string, { width: number; height: number }>;
      setSavedSizes(sizes);
      setDraftSizes(sizes);
    } catch {
      setSavedSizes({});
      setDraftSizes({});
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setCashLoading(true);
      try {
        const [cg, cl, fg, fl, intra, tb, demand] = await Promise.all([
          fetch("/api/dashboard/cash-gainers").then((r) => r.json()),
          fetch("/api/dashboard/cash-losers").then((r) => r.json()),
          fetch("/api/dashboard/futures-gainers").then((r) => r.json()),
          fetch("/api/dashboard/futures-losers").then((r) => r.json()),
          fetch("/api/dashboard/intraday-stocks").then((r) => r.json()),
          fetch("/api/dashboard/top-buy").then((r) => r.json()),
          fetch("/api/dashboard/demand-stocks").then((r) => r.json())
        ]);

        if (cg?.ok && Array.isArray(cg.data) && cg.data.length > 0) {
          setCashGainers(
            cg.data.map((r: any) => [r.symbol, r.price, r.pct, r.volume, "-"])
          );
        }
        if (cl?.ok && Array.isArray(cl.data) && cl.data.length > 0) {
          setCashLosers(
            cl.data.map((r: any) => [r.symbol, r.price, r.pct, r.volume, "-"])
          );
        }
        if (fg?.ok && Array.isArray(fg.data) && fg.data.length > 0) {
          setFutGainers(
            fg.data.map((r: any) => [r.symbol, r.price, r.pct, r.volume, "-"])
          );
        }
        if (fl?.ok && Array.isArray(fl.data) && fl.data.length > 0) {
          setFutLosers(
            fl.data.map((r: any) => [r.symbol, r.price, r.pct, r.volume, "-"])
          );
        }
        if (intra?.ok && Array.isArray(intra.data) && intra.data.length > 0) {
          setIntradayStocks(
            intra.data.map((r: any) => [r.symbol, r.price, r.pct, r.volume, "-"])
          );
        }
        if (tb?.ok && Array.isArray(tb.data) && tb.data.length > 0) {
          setTopBuy(
            tb.data.map((r: any) => [r.symbol, r.price, r.pct, r.volume, "-"])
          );
        }
        if (demand?.ok && Array.isArray(demand.data) && demand.data.length > 0) {
          const colors = ["#5cc1f0", "#ff7aa2", "#82d97d", "#f2b357", "#7a7df0", "#e4d34f"];
          setDemandLegend(
            demand.data.map((d: any, idx: number) => ({
              label: d.label,
              value: d.value,
              color: colors[idx % colors.length]
            }))
          );
        }
      } catch {
        // ignore
      } finally {
        setCashLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!editMode || !gridRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setDraftSizes((prev) => {
        const next = { ...prev };
        entries.forEach((entry) => {
          const id = (entry.target as HTMLElement).dataset.cardId;
          if (!id) return;
          const { width, height } = entry.contentRect;
          next[id] = { width: Math.round(width), height: Math.round(height) };
        });
        return next;
      });
    });

    const nodes = gridRef.current.querySelectorAll<HTMLElement>("[data-card-id]");
    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, [editMode]);

  const commitLayout = () => {
    setSavedSizes(draftSizes);
    localStorage.setItem(SIZE_KEY, JSON.stringify(draftSizes));
    setEditMode(false);
  };

  const totalForLegend = (legend: Card["legend"]) =>
    (legend || []).reduce((acc, cur) => acc + cur.value, 0);

  const buildPieStyle = (legend: Card["legend"]) => {
    if (!legend || legend.length === 0) return {};
    const total = totalForLegend(legend);
    let acc = 0;
    const parts = legend
      .map((slice) => {
        const start = (acc / total) * 360;
        acc += slice.value;
        const end = (acc / total) * 360;
        return `${slice.color} ${start}deg ${end}deg`;
      })
      .join(", ");
    return { background: `conic-gradient(${parts})` } as const;
  };

  const onDrop = (targetId: string) => {
    const sourceId = dragId.current;
    if (!sourceId || sourceId === targetId) return;
    setCards((prev) => {
      const next = [...prev];
      const fromIndex = next.findIndex((c) => c.id === sourceId);
      const toIndex = next.findIndex((c) => c.id === targetId);
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map((c) => c.id)));
      return next;
    });
  };

  const onDragEnd = () => {
    dragId.current = null;
    setDraggingId(null);
    setOverId(null);
  };

  const metricForCell = (value: string | number, column: string) => {
    if (typeof value !== "string") return "";
    if (column.includes("%") && value.startsWith("-")) return "neg";
    if (column.includes("%")) return "pos";
    if (column.toLowerCase().includes("change")) {
      return value.startsWith("-") ? "neg" : "pos";
    }
    return "";
  };

  const resolveRows = (card: Card) => {
    const rows =
      card.id === "cash-gainers" && cashGainers ? cashGainers :
      card.id === "cash-losers" && cashLosers ? cashLosers :
      card.id === "fut-gainers" && futGainers ? futGainers :
      card.id === "fut-losers" && futLosers ? futLosers :
      card.id === "intraday" && intradayStocks ? intradayStocks :
      card.id === "top-buy" && topBuy ? topBuy :
      card.rows;
    return rows || [];
  };

  const resolveLegend = (card: Card) => {
    if (card.id === "demand" && demandLegend) return demandLegend;
    return card.legend || [];
  };

  const resolveColumns = (card: Card, rows: (string | number)[][]) => {
    if (!card.columns) return [];
    return card.columns.filter((_, colIdx) =>
      rows.some((row) => {
        const cell = row[colIdx];
        if (cell === null || cell === undefined) return false;
        const str = String(cell).trim();
        return str !== "" && str !== "-";
      })
    );
  };

  return (
    <main className="page dashboard">
      <section className="dash-header">
        <div>
          <div className="eyebrow">Emphasis Dashboard</div>
          <h1>Market Pulse</h1>
          <p className="muted-text">
            Live snapshot of leaders, laggards, demand pockets, and VWAP strength.
          </p>
        </div>
        <div className="dash-actions">
          {!editMode ? (
            <button className="btn ghost" type="button" onClick={() => setEditMode(true)}>
              Edit Layout
            </button>
          ) : (
            <button className="btn primary" type="button" onClick={commitLayout}>
              Save Layout
            </button>
          )}
          <div className="dash-note">Drag and resize while editing</div>
        </div>
      </section>

      <section className={`dash-grid ${editMode ? "editing" : ""}`} ref={gridRef}>
        {cards.map((card) => {
          const rows = resolveRows(card);
          const legend = resolveLegend(card);
          const columns = card.kind === "table" ? resolveColumns(card, rows) : card.columns || [];
          const hasRows = card.kind === "table" ? rows.length > 0 : true;
          const hasLegend = card.kind === "pie" || card.kind === "donut" ? legend.length > 0 : true;
          if ((card.kind === "table" && (!hasRows || columns.length === 0)) ||
              ((card.kind === "pie" || card.kind === "donut") && !hasLegend)) {
            return null;
          }

          return (
          <article
            key={card.id}
            className={`dash-card ${card.kind} ${overId === card.id ? "drag-over" : ""}`}
            data-card-id={card.id}
            style={
              editMode && draftSizes[card.id]
                ? {
                    width: draftSizes[card.id]?.width,
                    height: draftSizes[card.id]?.height
                  }
                : undefined
            }
            draggable={editMode}
            onDragStart={(e) => {
              if (!editMode) return;
              dragId.current = card.id;
              setDraggingId(card.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", card.id);
            }}
            onDragOver={(e) => {
              if (editMode) e.preventDefault();
            }}
            onDragEnter={() => {
              if (editMode && draggingId !== card.id) setOverId(card.id);
            }}
            onDrop={() => {
              if (editMode) onDrop(card.id);
            }}
            onDragEnd={onDragEnd}
          >
            <div className="card-head">
              <div>
                <h3>{card.title}</h3>
                {card.subtitle ? <span className="muted-text">{card.subtitle}</span> : null}
              </div>
              {editMode ? (
                <button
                  className="drag-handle"
                  type="button"
                  title="Drag"
                  draggable
                  onDragStart={(e) => {
                    dragId.current = card.id;
                    setDraggingId(card.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", card.id);
                  }}
                  onDragEnd={onDragEnd}
                >
                  ⠿
                </button>
              ) : null}
            </div>

            {card.kind === "table" && card.columns && card.rows ? (
              <div className="mini-table">
                <div className="mini-head">
                  {columns.map((col) => (
                    <div key={col} className="mini-cell head">
                      {col}
                    </div>
                  ))}
                </div>
                <div className="mini-body">
                  {rows.map((row, idx) => (
                    <div key={idx} className="mini-row">
                      {row
                        .filter((_, cellIdx) => columns.includes(card.columns?.[cellIdx] || ""))
                        .map((cell, cellIdx) => (
                        <div
                          key={cellIdx}
                          className={`mini-cell ${metricForCell(String(cell), columns[cellIdx] || "")}`}
                        >
                          {cell}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(card.kind === "pie" || card.kind === "donut") && card.legend ? (
              <div className="chart-wrap">
                <div
                  className={`chart ${card.kind}`}
                  style={buildPieStyle(legend)}
                >
                  {card.kind === "donut" ? <div className="hole">VWAP</div> : null}
                </div>
                <div className="chart-legend">
                  {legend.map((item) => (
                    <div key={item.label} className="legend-item">
                      <span className="dot" style={{ background: item.color }} />
                        <div>
                          <div className="legend-label">{item.label}</div>
                          <div className="legend-value">
                          {numberFormat.format(item.value)}
                          </div>
                        </div>
                      </div>
                  ))}
                </div>
              </div>
            ) : null}

            {card.kind === "list" && card.notes ? (
              <ul className="card-list">
                {card.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </article>
        )})}
      </section>
    </main>
  );
}
