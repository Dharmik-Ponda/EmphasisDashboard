"use client";

import { useMemo, useState } from "react";

const DISABLED_NOTICE = true;

const dataByDate = {
  "2026-02-06": [
    {
      participant: "FII",
      items: [
        {
          segment: "Index Futures",
          bias: "Strong Bearish",
          tone: "bearish",
          strength: "strong",
          netOi: "-1.5L",
          change: "-6,228",
          children: [
            { segment: "NIFTY", bias: "Medium Bearish", tone: "bearish", strength: "medium", netOi: "--", change: "-3,671" },
            { segment: "BANKNIFTY", bias: "Medium Bearish", tone: "bearish", strength: "medium", netOi: "--", change: "-1,591" },
            { segment: "MIDCPNIFTY", bias: "Medium Bearish", tone: "bearish", strength: "medium", netOi: "--", change: "-970" },
            { segment: "FINNIFTY", bias: "Mild Bullish", tone: "bullish", strength: "mild", netOi: "--", change: "4" },
            { segment: "NIFTYNXT50", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "--", change: "0" }
          ]
        },
        {
          segment: "Index Options",
          bias: "Medium Bearish",
          tone: "bearish",
          strength: "medium",
          netOi: "-3.48L",
          change: "19,002",
          children: [
            { segment: "Call Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "-30,696", change: "42,047" },
            { segment: "Put Options", bias: "Medium Bearish", tone: "bearish", strength: "medium", netOi: "3.17L", change: "23,045" }
          ]
        }
      ]
    },
    {
      participant: "Pro",
      items: [
        {
          segment: "Index Futures",
          bias: "Indecisive",
          tone: "neutral",
          strength: "low",
          netOi: "-36,543",
          change: "3,551"
        },
        {
          segment: "Index Options",
          bias: "Mild Bullish",
          tone: "bullish",
          strength: "mild",
          netOi: "86,452",
          change: "1.03L",
          children: [
            { segment: "Call Options", bias: "Mild Bullish", tone: "bullish", strength: "mild", netOi: "23,425", change: "61,314" },
            { segment: "Put Options", bias: "Mild Bullish", tone: "bullish", strength: "mild", netOi: "-63,027", change: "-42,050" }
          ]
        }
      ]
    },
    {
      participant: "Client",
      items: [
        {
          segment: "Index Futures",
          bias: "Medium Bullish",
          tone: "bullish",
          strength: "medium",
          netOi: "1.06L",
          change: "1,862"
        },
        {
          segment: "Index Options",
          bias: "Indecisive",
          tone: "neutral",
          strength: "low",
          netOi: "3.24L",
          change: "-1.22L",
          children: [
            { segment: "Call Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "6,613", change: "-1.03L" },
            { segment: "Put Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "-3.17L", change: "18,642" }
          ]
        }
      ]
    }
  ],
  "2026-02-07": [
    {
      participant: "FII",
      items: [
        {
          segment: "Index Futures",
          bias: "Medium Bearish",
          tone: "bearish",
          strength: "medium",
          netOi: "-1.2L",
          change: "-4,120",
          children: [
            { segment: "NIFTY", bias: "Medium Bearish", tone: "bearish", strength: "medium", netOi: "--", change: "-2,811" },
            { segment: "BANKNIFTY", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "--", change: "-420" },
            { segment: "MIDCPNIFTY", bias: "Mild Bullish", tone: "bullish", strength: "mild", netOi: "--", change: "210" },
            { segment: "FINNIFTY", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "--", change: "0" }
          ]
        },
        {
          segment: "Index Options",
          bias: "Indecisive",
          tone: "neutral",
          strength: "low",
          netOi: "-1.8L",
          change: "6,102",
          children: [
            { segment: "Call Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "-18,210", change: "15,880" },
            { segment: "Put Options", bias: "Mild Bullish", tone: "bullish", strength: "mild", netOi: "2.1L", change: "10,415" }
          ]
        }
      ]
    },
    {
      participant: "Pro",
      items: [
        {
          segment: "Index Futures",
          bias: "Indecisive",
          tone: "neutral",
          strength: "low",
          netOi: "-21,480",
          change: "2,230"
        },
        {
          segment: "Index Options",
          bias: "Mild Bullish",
          tone: "bullish",
          strength: "mild",
          netOi: "72,640",
          change: "82,510",
          children: [
            { segment: "Call Options", bias: "Mild Bullish", tone: "bullish", strength: "mild", netOi: "19,340", change: "41,190" },
            { segment: "Put Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "-51,880", change: "-18,320" }
          ]
        }
      ]
    },
    {
      participant: "Client",
      items: [
        {
          segment: "Index Futures",
          bias: "Mild Bullish",
          tone: "bullish",
          strength: "mild",
          netOi: "82,450",
          change: "1,210"
        },
        {
          segment: "Index Options",
          bias: "Indecisive",
          tone: "neutral",
          strength: "low",
          netOi: "2.1L",
          change: "-9,800",
          children: [
            { segment: "Call Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "3,640", change: "-6,210" },
            { segment: "Put Options", bias: "Indecisive", tone: "neutral", strength: "low", netOi: "-2.5L", change: "12,120" }
          ]
        }
      ]
    }
  ]
};

const dates = Object.keys(dataByDate);

export default function FiiDiiPage() {
  if (DISABLED_NOTICE) {
    return (
      <main className="page fii-dii">
        <section className="fii-card">
          <div className="table-body">
            <div className="table-row">
              <div className="cell participant">
                <span>FII/DII</span>
              </div>
              <div className="cell segment">
                <span className="segment-label">Under R&amp;D</span>
              </div>
              <div className="cell bias neutral">
                <div className="bias-chip neutral low">Coming Soon</div>
                <div className="bias-track neutral">
                  <span className="low" />
                </div>
              </div>
              <div className="cell value">—</div>
              <div className="cell value">—</div>
            </div>
          </div>
        </section>
      </main>
    );
  }
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [openSegments, setOpenSegments] = useState<Record<string, boolean>>({
    "FII-Index Futures": false,
    "FII-Index Options": false,
    "Pro-Index Futures": false,
    "Pro-Index Options": false,
    "Client-Index Futures": false,
    "Client-Index Options": false
  });

  const data = dataByDate[selectedDate as keyof typeof dataByDate];
  const labelDate = useMemo(() => {
    const [y, m, d] = selectedDate.split("-");
    const month = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleString("en-US", {
      month: "short"
    });
    return `${d} ${month} ${y}`;
  }, [selectedDate]);

  return (
    <main className="page fii-dii">
      <section className="fii-header">
        <div>
          <div className="eyebrow">Market Activity</div>
          <h1>FII &amp; DII Positioning</h1>
          <p className="muted-text">
            Track institutional sentiment across futures and options in one view.
          </p>
        </div>
        <div className="fii-controls">
          <div className="tooltip-wrap">
            <button className="chip ghost" type="button">
              How to interpret this data?
            </button>
            <div className="tooltip">
              <strong>Quick guide</strong>
              <ul>
                <li>Bearish = net selling pressure.</li>
                <li>Bullish = net buying support.</li>
                <li>Neutral = mixed flow, no clear bias.</li>
              </ul>
            </div>
          </div>
          <button className="chip ghost" type="button">
            Replay
          </button>
          <div className="fii-date">
            <button
              className="nav-arrow"
              type="button"
              aria-label="Previous day"
              onClick={() => {
                const idx = dates.indexOf(selectedDate);
                if (idx > 0) setSelectedDate(dates[idx - 1]);
              }}
            >
              ‹
            </button>
            <select
              className="date-pill select"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            >
              {dates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
            <button
              className="nav-arrow"
              type="button"
              aria-label="Next day"
              onClick={() => {
                const idx = dates.indexOf(selectedDate);
                if (idx < dates.length - 1) setSelectedDate(dates[idx + 1]);
              }}
            >
              ›
            </button>
          </div>
          <div className="date-label">{labelDate}</div>
        </div>
      </section>

      <section className="fii-card">
        <div className="table-head">
          <div className="label">Participant</div>
          <div className="label">Segment</div>
          <div className="label">Bias</div>
          <div className="label">Net OI</div>
          <div className="label">Change</div>
        </div>
        <div className="table-body">
          {data.map((group) =>
            group.items.map((row, idx) => {
              const key = `${group.participant}-${row.segment}`;
              const isOpen = !!openSegments[key];
              const hasChildren = row.children && row.children.length > 0;
              const showToggle = hasChildren;
              const rowsToRender = [
                row,
                ...(hasChildren && isOpen ? row.children : [])
              ];

              return rowsToRender.map((currentRow, childIdx) => {
                const isChild = childIdx > 0;
                return (
                  <div
                    className={`table-row ${isChild ? "child-row" : ""}`}
                    key={`${key}-${currentRow.segment}-${childIdx}`}
                  >
                    <div className="cell participant">
                      {idx === 0 && childIdx === 0 ? <span>{group.participant}</span> : null}
                    </div>
                    <div className="cell segment">
                      {showToggle && !isChild ? (
                        <button
                          type="button"
                          className="segment-toggle"
                          onClick={() =>
                            setOpenSegments((prev) => ({
                              ...prev,
                              [key]: !prev[key]
                            }))
                          }
                          disabled={!hasChildren}
                        >
                          {currentRow.segment}
                          <span className={`caret ${isOpen ? "open" : ""}`}>▾</span>
                        </button>
                      ) : (
                        <span className="segment-label">{currentRow.segment}</span>
                      )}
                    </div>
                    <div className={`cell bias ${currentRow.tone}`}>
                      <div className={`bias-chip ${currentRow.tone} ${currentRow.strength}`}>
                        {currentRow.bias}
                      </div>
                      <div className={`bias-track ${currentRow.tone}`}>
                        <span className={currentRow.strength} />
                      </div>
                    </div>
                    <div className="cell value">{currentRow.netOi}</div>
                    <div
                      className={`cell value ${currentRow.change.startsWith("-") ? "down" : "up"}`}
                    >
                      {currentRow.change}
                    </div>
                  </div>
                );
              });
            })
          )}
        </div>
      </section>
    </main>
  );
}
