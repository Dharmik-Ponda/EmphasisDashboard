import OptionChainClient from "../../nifty/option-chain/OptionChainClient";
import PcrTableClient from "../../PcrTableClient";

async function getOptionChain() {
  const base = process.env.NEXTAUTH_URL || "http://localhost:5000";
  const key = process.env.UPSTOX_SENSEX_KEY || "BSE_INDEX|SENSEX";
  const url = new URL("/api/nifty/option-chain", base);
  url.searchParams.set("instrument_key", key);
  url.searchParams.set("include_history", "1");
  const res = await fetch(url.toString(), {
    cache: "no-store"
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    return { error: error?.error || "Failed to load option chain" };
  }
  return res.json();
}

export default async function SensexOptionChainPage() {
  const data = await getOptionChain();
  if ("error" in data) {
    return (
      <main className="page">
        <div className="pcr">
          <div className="pcr-header">
            <div>
              <div className="eyebrow">Option Chain</div>
              <h2>Unable to load data</h2>
            </div>
          </div>
          <p className="error">{data.error}</p>
        </div>
      </main>
    );
  }
  const sensexKey = process.env.UPSTOX_SENSEX_KEY || "BSE_INDEX|SENSEX";
  return (
    <main className="page">
      <PcrTableClient title="Sensex Live PCR" instrumentKey={sensexKey} />
      <div className="section-divider" />
      <OptionChainClient initialData={data} symbol="SENSEX" instrumentKey={sensexKey} />
    </main>
  );
}
