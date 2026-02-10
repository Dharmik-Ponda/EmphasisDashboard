export default function SubscriptionPage() {
  return (
    <main className="page subscription">
      <section className="sub-hero">
        <div>
          <div className="eyebrow">Subscription</div>
          <h1>Choose the plan that fits your trading rhythm</h1>
          <p className="muted-text">
            Get full access to NIFTY option chain analytics, live PCR, and signals.
          </p>
        </div>
        <div className="hero-pill">
          <span>Secure checkout</span>
          <strong>Razorpay</strong>
        </div>
      </section>

      <section className="plans">
        <div className="plan-card">
          <div className="plan-head">
            <div>
              <div className="plan-title">Monthly</div>
              <div className="plan-period">For active traders</div>
            </div>
            <div className="plan-pill">Starter</div>
          </div>
          <div className="plan-price-row">
            <div className="plan-price">₹99</div>
            <div className="plan-period">/ month</div>
          </div>
          <ul className="plan-features">
            <li>Full option chain</li>
            <li>Live PCR table</li>
            <li>All expiries</li>
          </ul>
          <button className="btn primary" disabled>
            Buy Monthly (Razorpay soon)
          </button>
        </div>

        <div className="plan-card featured">
          <div className="plan-badge">Best Value</div>
          <div className="plan-head">
            <div>
              <div className="plan-title">Yearly</div>
              <div className="plan-period">For serious traders</div>
            </div>
            <div className="plan-pill solid">Save 2 months</div>
          </div>
          <div className="plan-price-row">
            <div className="plan-price">₹999</div>
            <div className="plan-period">/ year</div>
          </div>
          <ul className="plan-features">
            <li>Everything in monthly</li>
            <li>Priority updates</li>
            <li>12 months access</li>
            <li>All expiries</li>
          </ul>
          <button className="btn primary" disabled>
            Buy Yearly (Razorpay soon)
          </button>
        </div>
      </section>

      <section className="sub-faq">
        <div className="faq-card">
          <div className="faq-icon">⟲</div>
          <h3>Cancel anytime</h3>
          <p className="muted-text">You can cancel before the next billing cycle.</p>
        </div>
        <div className="faq-card">
          <div className="faq-icon">⚡</div>
          <h3>Instant access</h3>
          <p className="muted-text">Subscription activates right after payment.</p>
        </div>
        <div className="faq-card">
          <div className="faq-icon">🔒</div>
          <h3>Secure payments</h3>
          <p className="muted-text">Powered by Razorpay with bank-grade security.</p>
        </div>
      </section>
    </main>
  );
}
