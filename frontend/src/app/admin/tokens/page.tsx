import { getServerSession } from "next-auth";
import TokenVaultClient from "./TokenVaultClient";
import { authOptions } from "@/lib/auth";

const ADMIN_EMAILS = ["dharmikponda77@gmail.com"];

export default async function AdminTokensPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || "";

  if (!email || !ADMIN_EMAILS.includes(email)) {
    return (
      <main className="page dashboard">
        <section className="fii-card">
          <div className="table-body">
            <div className="table-row">
              <div className="cell participant">
                <span>Admin Only</span>
              </div>
              <div className="cell segment">
                <span className="segment-label">Access denied</span>
              </div>
              <div className="cell bias neutral">
                <div className="bias-chip neutral low">Not Authorized</div>
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

  return (
    <main className="page dashboard">
      <TokenVaultClient />
    </main>
  );
}
