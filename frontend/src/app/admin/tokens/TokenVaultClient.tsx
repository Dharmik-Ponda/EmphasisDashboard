"use client";

import { useState } from "react";

export default function TokenVaultClient() {
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setMessage("");

    const res = await fetch("/api/admin/upstox-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus("error");
      setMessage(data?.error || "Failed to save token");
      return;
    }

    setStatus("success");
    setMessage("Token saved successfully.");
    setAccessToken("");
  };

  return (
    <section className="token-vault">
      <div className="vault-head">
        <div>
          <div className="eyebrow">Admin Tools</div>
          <h1>Upstox Token Vault</h1>
          <p className="muted-text">
            Paste the latest access token. This will replace the current token used by the API.
          </p>
        </div>
      </div>

      <form className="vault-form" onSubmit={submit}>
        <label className="vault-label" htmlFor="accessToken">
          Access Token
        </label>
        <textarea
          id="accessToken"
          className="vault-input"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          rows={4}
          placeholder="Paste the Upstox access token here"
          required
        />
        <div className="vault-actions">
          <button className="btn primary" type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Saving..." : "Save Token"}
          </button>
          {message ? (
            <span className={`vault-message ${status}`}>{message}</span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
