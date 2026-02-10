import "./globals.css";
import Providers from "./providers";
import Header from "./Header";
import Link from "next/link";
import RouteLoader from "./RouteLoader";

export const metadata = {
  title: "Emphasis Dashboard",
  description: "Frontend for EmphasisDashboard",
  icons: {
    icon: [
      { url: "/logo-emphasis-d-16.png", sizes: "16x16", type: "image/png" },
      { url: "/logo-emphasis-d-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logo-emphasis-d-192.png", sizes: "192x192", type: "image/png" },
      { url: "/logo-emphasis-d-512.png", sizes: "512x512", type: "image/png" }
    ],
    shortcut: "/logo-emphasis-d-32.png",
    apple: "/logo-emphasis-d-180.png"
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <RouteLoader />
          <Header />
          {children}
          <footer className="app-footer">
            <div className="footer-inner">
              <div className="footer-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="brand-logo footer-logo" src="/logo-emphasis-d-400x120.png" alt="Emphasis Trading" />
              </div>
              <div className="footer-links">
                <Link href="/subscription">Subscription</Link>
                <Link href="/nifty/option-chain">NIFTY</Link>
                <Link href="/sensex/option-chain">SENSEX</Link>
              </div>
              <div className="footer-meta">
                <span>© 2026 Emphasis Dashboard</span>
                <span>Built in India</span>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
