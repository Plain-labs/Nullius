/**
 * LandingPage
 *
 * Full marketing-style landing page shown to unauthenticated visitors.
 * Sections: Hero → How it works → Tier comparison → Final CTA
 */

interface Props {
  onConnect: () => void;
  connecting: boolean;
  error: string | null;
}

const STEPS = [
  {
    num: "01",
    title: "Connect your wallet",
    desc: "Link your Stellar wallet via Freighter. Nothing is sent to any server.",
  },
  {
    num: "02",
    title: "Load on-chain history",
    desc: "Fetch your real transaction history directly from Stellar Horizon — stays in your browser.",
  },
  {
    num: "03",
    title: "Generate a ZK proof",
    desc: "Your browser computes a zero-knowledge proof of your reputation score without exposing any raw data.",
  },
  {
    num: "04",
    title: "Unlock lower fees",
    desc: "Submit the proof on-chain. Higher tiers grant lower transaction fees and larger payment limits.",
  },
];

const TIERS = [
  {
    name: "Unverified",
    color: "#64748b",
    fee: "5.0%",
    limit: "1,000 XLM",
    perks: ["Basic access", "Standard fee rate"],
    threshold: null,
  },
  {
    name: "Bronze",
    color: "#b45309",
    fee: "2.0%",
    limit: "10,000 XLM",
    perks: ["Score ≥ 40", "Reduced fees", "10× payment limit"],
    threshold: 40,
  },
  {
    name: "Silver",
    color: "#94a3b8",
    fee: "1.0%",
    limit: "100,000 XLM",
    perks: ["Score ≥ 70", "Low fees", "100× payment limit"],
    threshold: 70,
  },
  {
    name: "Gold",
    color: "#d97706",
    fee: "0.3%",
    limit: "1,000,000 XLM",
    perks: ["Score ≥ 85", "Lowest fees", "Undercollateralised credit"],
    threshold: 85,
    highlight: true,
  },
];

const FEATURES = [
  {
    icon: "🔒",
    title: "Your data never leaves your browser",
    desc: "Zero-knowledge proofs let you prove facts about your finances without sharing the underlying numbers.",
  },
  {
    icon: "⛓",
    title: "Verified on Stellar",
    desc: "Proofs are submitted to and verified by a Rust/WASM smart contract deployed on Stellar testnet.",
  },
  {
    icon: "⬡",
    title: "No identity required",
    desc: "No KYC, no email, no personal data. Your wallet address is the only identifier.",
  },
  {
    icon: "⚡",
    title: "Instant fee benefits",
    desc: "Once your tier is on-chain every payment through the PaymentGate contract applies your discounted rate automatically.",
  },
];

export function LandingPage({ onConnect, connecting, error }: Props) {
  return (
    <div className="landing">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden="true" />
        <div className="landing-container">
          <div className="landing-badge">
            <span className="landing-badge-dot" />
            Live on Stellar Testnet
          </div>

          <h1 className="landing-title">
            Private Reputation.
            <br />
            <span className="landing-title-accent">Public Proof.</span>
          </h1>

          <p className="landing-subtitle">
            Prove your financial trustworthiness on Stellar using zero-knowledge
            cryptography — without revealing a single transaction, balance, or
            personal detail.
          </p>

          <div className="landing-hero-cta">
            <button
              className="btn-primary btn-lg"
              onClick={onConnect}
              disabled={connecting}
              aria-busy={connecting}
            >
              {connecting ? (
                <>
                  <span className="wallet-spinner" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                "Connect Freighter Wallet"
              )}
            </button>
            <a
              className="landing-learn-link"
              href="https://github.com/nullius-zk/nullius"
              target="_blank"
              rel="noreferrer"
            >
              Read the docs →
            </a>
          </div>

          {error && (
            <div className="error-box landing-error" role="alert">
              {error}
              {error.toLowerCase().includes("install") && (
                <>
                  {" "}
                  <a href="https://freighter.app" target="_blank" rel="noreferrer">
                    Get Freighter →
                  </a>
                </>
              )}
            </div>
          )}

          {/* Key stats strip */}
          <div className="landing-stats">
            <div className="landing-stat">
              <span className="landing-stat-val">3</span>
              <span className="landing-stat-label">Reputation tiers</span>
            </div>
            <div className="landing-stat-divider" aria-hidden="true" />
            <div className="landing-stat">
              <span className="landing-stat-val">0.3%</span>
              <span className="landing-stat-label">Lowest fee (Gold)</span>
            </div>
            <div className="landing-stat-divider" aria-hidden="true" />
            <div className="landing-stat">
              <span className="landing-stat-val">0 bytes</span>
              <span className="landing-stat-label">Data shared on-chain</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features grid ────────────────────────────────────── */}
      <section className="landing-section" aria-labelledby="features-heading">
        <div className="landing-container">
          <h2 className="landing-section-title" id="features-heading">
            Built for privacy-first finance
          </h2>
          <p className="landing-section-sub">
            Nullius uses Groth16 ZK proofs compiled with Circom, verified by a
            Stylus smart contract on Stellar testnet.
          </p>
          <div className="landing-features-grid">
            {FEATURES.map((f) => (
              <div className="landing-feature-card" key={f.title}>
                <div className="landing-feature-icon" aria-hidden="true">
                  {f.icon}
                </div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section
        className="landing-section landing-section--alt"
        aria-labelledby="how-heading"
      >
        <div className="landing-container">
          <h2 className="landing-section-title" id="how-heading">
            How it works
          </h2>
          <p className="landing-section-sub">
            From wallet connect to on-chain proof in four steps — entirely in your browser.
          </p>
          <ol className="landing-steps" aria-label="Steps to generate a reputation proof">
            {STEPS.map((s, i) => (
              <li className="landing-step" key={s.num}>
                <div className="landing-step-num" aria-hidden="true">
                  {s.num}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="landing-step-connector" aria-hidden="true" />
                )}
                <div className="landing-step-body">
                  <h3 className="landing-step-title">{s.title}</h3>
                  <p className="landing-step-desc">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Tier comparison ──────────────────────────────────── */}
      <section className="landing-section" aria-labelledby="tiers-heading">
        <div className="landing-container">
          <h2 className="landing-section-title" id="tiers-heading">
            Reputation tiers
          </h2>
          <p className="landing-section-sub">
            Your ZK proof unlocks a tier on-chain. Higher tiers mean lower fees
            and higher payment limits — automatically applied by the smart contract.
          </p>
          <div className="landing-tiers-grid">
            {TIERS.map((t) => (
              <div
                className={`landing-tier-card${t.highlight ? " landing-tier-card--highlight" : ""}`}
                key={t.name}
                style={{ "--tier-color": t.color } as React.CSSProperties}
              >
                {t.highlight && (
                  <div className="landing-tier-badge">Best tier</div>
                )}
                <div
                  className="landing-tier-ring"
                  style={{ background: t.color }}
                  aria-hidden="true"
                >
                  <span className="landing-tier-ring-label">{t.name[0]}</span>
                </div>
                <h3 className="landing-tier-name">{t.name}</h3>
                {t.threshold !== null && (
                  <p className="landing-tier-threshold">Score ≥ {t.threshold}</p>
                )}
                <div className="landing-tier-stats">
                  <div className="landing-tier-stat">
                    <span className="landing-tier-stat-label">Fee</span>
                    <strong className="landing-tier-stat-val">{t.fee}</strong>
                  </div>
                  <div className="landing-tier-stat">
                    <span className="landing-tier-stat-label">Max / tx</span>
                    <strong className="landing-tier-stat-val">{t.limit}</strong>
                  </div>
                </div>
                <ul className="landing-tier-perks">
                  {t.perks.map((p) => (
                    <li key={p}>
                      <span className="landing-tier-check" aria-hidden="true">✓</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────── */}
      <section className="landing-cta-section" aria-labelledby="cta-heading">
        <div className="landing-container">
          <div className="landing-cta-card">
            <div className="landing-cta-icon" aria-hidden="true">⬡</div>
            <h2 className="landing-cta-title" id="cta-heading">
              Ready to prove your reputation?
            </h2>
            <p className="landing-cta-sub">
              Connect your Freighter wallet and generate your first ZK proof.
              No personal data required, ever.
            </p>
            <button
              className="btn-primary btn-lg"
              onClick={onConnect}
              disabled={connecting}
              aria-busy={connecting}
            >
              {connecting ? (
                <>
                  <span className="wallet-spinner" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                "Get started — Connect Wallet"
              )}
            </button>
            <p className="landing-cta-hint">
              Need Freighter?{" "}
              <a href="https://freighter.app" target="_blank" rel="noreferrer">
                Install the browser extension →
              </a>
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}
