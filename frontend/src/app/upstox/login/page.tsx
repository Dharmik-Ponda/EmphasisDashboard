"use client";

import { useEffect, useMemo, useState } from "react";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" }
  | { status: "exchanged" };

export default function UpstoxLoginPage() {
  const [state, setState] = useState<State>({ status: "idle" });

  const code = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("code");
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!code) {
        setState({ status: "ready" });
        return;
      }
      setState({ status: "loading" });
      const res = await fetch("/api/upstox/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          status: "error",
          message: data?.error || "Session exchange failed"
        });
        return;
      }
      setState({ status: "exchanged" });
    };
    void load();
  }, [code]);

  return (
    <main className="page">
      <h1>Upstox Login</h1>
      {state.status === "loading" && <p>Exchanging code…</p>}
      {state.status === "error" && <p>{state.message}</p>}
      {state.status === "ready" && (
        <a href="/api/upstox/login" className="btn">
          Sign in with Upstox
        </a>
      )}
      {state.status === "exchanged" && (
        <>
          <p>Access token stored on the server.</p>
          <a href="/nifty/option-chain" className="btn">
            Go to Option Chain
          </a>
        </>
      )}
    </main>
  );
}
