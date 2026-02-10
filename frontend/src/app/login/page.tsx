"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [status, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: true,
      callbackUrl: "/nifty/option-chain"
    });
    if (res?.error) setError("Invalid credentials");
  };

  return (
    <main className="page auth">
      <div className="auth-card">
        <div className="eyebrow">Welcome Back</div>
        <h1>Sign in</h1>
        <p className="muted-text">Access your NIFTY analytics dashboard.</p>
        <p className="auth-warning">Login required to access the dashboard.</p>

        <button
          className="btn google"
          onClick={() => signIn("google", { callbackUrl: "/" })}
        >
          <span className="gmark" aria-hidden="true">G</span>
          Continue with Google
        </button>

        <div className="divider">or</div>

        <form onSubmit={onSubmit} className="auth-form">
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
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" type="submit">
            Sign in
          </button>
        </form>

        <p className="muted-text">
          New here? <a href="/signup">Create an account</a>
        </p>
      </div>
    </main>
  );
}
