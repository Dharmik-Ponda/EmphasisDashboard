"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

export default function Header() {
  const { data: session } = useSession();
  const user = session?.user;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [ocOpen, setOcOpen] = useState(false);
  const ocRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
      if (ocRef.current && !ocRef.current.contains(e.target as Node)) setOcOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo-emphasis-d-400x120.png" alt="Emphasis Trading" />
        </div>
        <nav className="nav">
        <Link href="/">Home</Link>
        <div className={`nav-item ${ocOpen ? "open" : ""}`} ref={ocRef}>
          <button
            type="button"
            className="nav-button"
            onClick={(e) => {
              e.stopPropagation();
              setOcOpen((v) => !v);
            }}
          >
            Option Chain <span className="caret">▾</span>
          </button>
          <div className="nav-dropdown">
            <Link href="/nifty/option-chain">NIFTY</Link>
            <Link href="/sensex/option-chain">SENSEX</Link>
          </div>
        </div>
        <Link href="/subscription">Subscription</Link>
        </nav>
      </div>
      {user ? (
        <div className={`user-menu ${open ? "open" : ""}`} ref={menuRef}>
          <button
            className="avatar"
            type="button"
            title={user.email || "Account"}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="User" />
            ) : (
              (user.name || user.email || "U")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()
            )}
          </button>
          <div className="user-dropdown">
            <div className="user-info">
              <div className="name">{user.name || "User"}</div>
              <div className="email">{user.email || ""}</div>
            </div>
            <button
              className="btn primary"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <Link className="nav-login" href="/login">Login</Link>
      )}
    </header>
  );
}
