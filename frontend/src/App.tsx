import { useState } from "react";
import { useFreighter } from "./hooks/useFreighter";
import { ProofGenerator } from "./components/ProofGenerator";
import { ReputationCard } from "./components/ReputationCard";
import { PaymentWidget } from "./components/PaymentWidget";
import { ProofHistory } from "./components/ProofHistory";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LandingPage } from "./components/LandingPage";
import type { ProofBundle, Tier } from "@nullius/sdk";

type Tab = "prove" | "score" | "pay" | "history";

export default function App() {
  const {
    connected,
    publicKey,
    loading,
    status,
    wrongNetwork,
    network,
    error: walletError,
    connect,
    disconnect,
  } = useFreighter();

  const [activeTab, setActiveTab]     = useState<Tab>("prove");
  const [latestProof, setLatestProof] = useState<ProofBundle | null>(null);
  const [verifiedTier, setVerifiedTier] = useState<Tier>(0);

  const tabs: { id: Tab; label: string }[] = [
    { id: "prove", label: "Generate Proof" },
    { id: "score", label: "My Score" },
    { id: "pay",   label: "Send Payment" },
    { id: "history", label: "History" },
  ];

  // ----------------------------------------------------------------
  // Header wallet button — three states: loading, connected, disconnected
  // ----------------------------------------------------------------
  const walletButton = () => {
    if (loading) {
      return (
        <button className="btn-primary" disabled>
          <span className="wallet-spinner" aria-hidden="true" />
          Checking wallet…
        </button>
      );
    }

    if (connected && publicKey) {
      return (
        <div className="wallet-connected-group">
          <div className="wallet-pill" title={publicKey}>
            <span className="wallet-dot" />
            {publicKey.slice(0, 6)}…{publicKey.slice(-4)}
          </div>
          <button
            className="btn-disconnect"
            onClick={disconnect}
            title="Disconnect wallet"
            aria-label="Disconnect wallet"
          >
            ✕
          </button>
        </div>
      );
    }

    return (
      <button
        className="btn-primary"
        onClick={connect}
        disabled={status === "connecting"}
      >
        {status === "connecting" ? (
          <>
            <span className="wallet-spinner" aria-hidden="true" />
            Connecting…
          </>
        ) : (
          "Connect Freighter"
        )}
      </button>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-mark">⬡</span>
            <span className="logo-text">Nullius</span>
            <span className="logo-tag">ZK Reputation on Stellar</span>
          </div>
          {walletButton()}
        </div>
      </header>

      {/* Wrong network banner — shown above everything when on mainnet/other */}
      {wrongNetwork && (
        <div className="network-warning-banner" role="alert">
          ⚠ Freighter is connected to{" "}
          <strong>{network ?? "an unknown network"}</strong>. Switch to{" "}
          <strong>Testnet</strong> in Freighter settings to use Nullius.
        </div>
      )}

      {/* ---- Not connected: full landing page ---- */}
      {!connected && !wrongNetwork ? (
        <LandingPage
          onConnect={connect}
          connecting={status === "connecting"}
          error={walletError}
        />
      ) : connected && publicKey ? (
        /* ---- Connected and on correct network: main app ---- */
        <main className="main">
          <nav className="tabs" role="tablist" aria-label="App sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                className={`tab ${activeTab === t.id ? "tab--active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-content" role="tabpanel">
            {activeTab === "prove" && (
              <ErrorBoundary>
                <ProofGenerator
                  walletAddress={publicKey}
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
                  walletAddress={publicKey}
                  latestProof={latestProof}
                  tier={verifiedTier}
                />
              </ErrorBoundary>
            )}
            {activeTab === "pay" && (
              <ErrorBoundary>
                <PaymentWidget
                  walletAddress={publicKey}
                  currentTier={verifiedTier}
                />
              </ErrorBoundary>
            )}
            {activeTab === "history" && (
              <ErrorBoundary>
                <ProofHistory walletAddress={publicKey} />
              </ErrorBoundary>
            )}
          </div>
        </main>
      ) : null}

      <footer className="footer">
        Nullius — ZK Reputation on Stellar · Open source ·{" "}
        <a
          href="https://github.com/nullius-zk/nullius"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
