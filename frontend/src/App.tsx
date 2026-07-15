import { useState } from "react";
import { useFreighter } from "./hooks/useFreighter";
import { ProofGenerator } from "./components/ProofGenerator";
import { ReputationCard } from "./components/ReputationCard";
import { PaymentWidget } from "./components/PaymentWidget";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { ProofBundle, Tier } from "@nullius/sdk";

type Tab = "prove" | "score" | "pay";

export default function App() {
  const { connected, publicKey, loading, error: walletError, connect } = useFreighter();
  const [activeTab, setActiveTab] = useState<Tab>("prove");
  const [latestProof, setLatestProof]   = useState<ProofBundle | null>(null);
  const [verifiedTier, setVerifiedTier] = useState<Tier>(0);

  const tabs: { id: Tab; label: string }[] = [
    { id: "prove", label: "Generate Proof" },
    { id: "score", label: "My Score" },
    { id: "pay",   label: "Send Payment" },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-mark">⬡</span>
            <span className="logo-text">Nullius</span>
            <span className="logo-tag">ZK Reputation on Stellar</span>
          </div>

          {!connected ? (
            <button className="btn-primary" onClick={connect} disabled={loading}>
              {loading ? "Checking wallet…" : "Connect Freighter"}
            </button>
          ) : (
            <div className="wallet-pill">
              <span className="wallet-dot" />
              {publicKey?.slice(0, 6)}…{publicKey?.slice(-4)}
            </div>
          )}
        </div>
      </header>

      {!connected ? (
        <div className="connect-screen">
          <div className="connect-card">
            <div className="connect-icon">⬡</div>
            <h1>Private Reputation. Public Proof.</h1>
            <p>
              Prove your financial trustworthiness on Stellar using zero-knowledge
              cryptography — without revealing any of your actual financial data.
            </p>
            <ul className="feature-list">
              <li>✓ Your data never leaves your browser</li>
              <li>✓ Proof verified on Stellar testnet</li>
              <li>✓ Lower fees for higher tiers</li>
            </ul>
            <button className="btn-primary btn-lg" onClick={connect}>
              Connect Freighter Wallet
            </button>
            {walletError && (
              <div className="error-box" style={{ marginTop: 16, textAlign: "left" }}>
                {walletError}
              </div>
            )}
            <p className="connect-hint">
              Don't have Freighter?{" "}
              <a href="https://freighter.app" target="_blank" rel="noreferrer">
                Install it here →
              </a>
            </p>
          </div>
        </div>
      ) : (
        <main className="main">
          <nav className="tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`tab ${activeTab === t.id ? "tab--active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {activeTab === "prove" && (
              <ErrorBoundary>
                <ProofGenerator
                  walletAddress={publicKey!}
                  onProofVerified={(bundle, tier) => {
                    setLatestProof(bundle);
                    setVerifiedTier(tier);
                    setActiveTab("score");
                  }}
                />
              </ErrorBoundary>
            )}
            {activeTab === "score" && (
              <ErrorBoundary>
                <ReputationCard
                  walletAddress={publicKey!}
                  latestProof={latestProof}
                  tier={verifiedTier}
                />
              </ErrorBoundary>
            )}
            {activeTab === "pay" && (
              <ErrorBoundary>
                <PaymentWidget
                  walletAddress={publicKey!}
                  currentTier={verifiedTier}
                />
              </ErrorBoundary>
            )}
          </div>
        </main>
      )}

      <footer className="footer">
        Built for Stellar Hacks: Real-World ZK · Open source ·{" "}
        <a href="https://github.com/your-repo/nullius" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}
