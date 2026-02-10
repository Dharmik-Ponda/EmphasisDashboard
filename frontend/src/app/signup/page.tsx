"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Signup failed");
      }
      await signIn("credentials", {
        email,
        password,
        redirect: true,
        callbackUrl: "/subscription"
      });
    } catch (err: any) {
      setError(err?.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page auth">
      <div className="auth-card">
        <div className="eyebrow">Get Started</div>
        <h1>Create account</h1>
        <p className="muted-text">Start your subscription and access all tools.</p>

        <button className="btn google" onClick={() => signIn("google", { callbackUrl: "/" })}>
          <span className="gmark" aria-hidden="true">G</span>
          Continue with Google
        </button>

        <div className="divider">or</div>

        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Phone
            <div className="phone-input">
              <span>+91</span>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{10}"
                placeholder="10-digit number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                required
              />
            </div>
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <p className="hint">
            Password must be 8+ chars with uppercase, lowercase, number, and symbol.
          </p>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="muted-text">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </main>
  );
}
