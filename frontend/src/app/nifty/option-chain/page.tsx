import OptionChainClient from "./OptionChainClient";
import PcrTableClient from "../../PcrTableClient";

async function getOptionChain() {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:5000";
  const url = new URL("/api/nifty/option-chain", baseUrl);
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

export default async function NiftyOptionChainPage() {
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
          <a className="pill metric" href="/upstox/login">
            <span className="label">Upstox</span>
            <span className="value">Login</span>
          </a>
        </div>
      </main>
    );
  }
  return (
    <main className="page">
      <PcrTableClient title="Nifty Live PCR" />
      <div className="section-divider" />
      <OptionChainClient initialData={data} symbol="NIFTY 50" />
    </main>
  );
}
