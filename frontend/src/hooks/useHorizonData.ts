/**
 * useHorizonData
 *
 * Fetches real on-chain data for a Stellar wallet address from Horizon API
 * and derives the PrivateInputs required by the ReputationScore ZK circuit.
 *
 * All data is fetched client-side and never sent to any server.
 * The derived inputs are passed directly to the proof generator.
 *
 * Data sources:
 *   - Account info   → base reserve, creation date (months active)
 *   - Payments       → transaction count, average XLM balance proxy
 *   - Failed txs     → dispute/failed transaction count
 */

import { useState, useCallback } from "react";
import type { PrivateInputs } from "@nullius/sdk";

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const HORIZON_MAINNET = "https://horizon.stellar.org";

// Use testnet unless overridden by env var
const HORIZON_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta.env as Record<string, string | undefined>)["VITE_STELLAR_NETWORK"] === "mainnet")
    ? HORIZON_MAINNET
    : HORIZON_TESTNET;

// Maximum pages of transactions to fetch (200 tx/page × MAX_PAGES)
// Kept low to stay fast in the browser; enough for realistic scoring
const MAX_PAGES = 5;
const PAGE_LIMIT = 200;

export interface HorizonData {
  /** Total successful transactions (payments + other ops) */
  txCount: number;
  /** Failed / timed-out transactions */
  failedTxCount: number;
  /** Average XLM balance over sampled ledgers (in XLM, not stroops) */
  avgBalanceXlm: number;
  /** How many whole months since the account was created */
  monthsActive: number;
  /** Raw current XLM balance (for display) */
  currentBalanceXlm: number;
  /** ISO date string of account creation (first transaction) */
  accountCreatedAt: string | null;
}

export type FetchState = "idle" | "fetching" | "done" | "error";

export function useHorizonData() {
  const [state, setState]     = useState<FetchState>("idle");
  const [data, setData]       = useState<HorizonData | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const fetch = useCallback(async (walletAddress: string) => {
    setState("fetching");
    setError(null);
    setData(null);

    try {
      // ----------------------------------------------------------------
      // 1. Account info — current balance + creation time
      // ----------------------------------------------------------------
      const accountRes = await window.fetch(
        `${HORIZON_URL}/accounts/${walletAddress}`
      );

      if (!accountRes.ok) {
        if (accountRes.status === 404) {
          throw new Error(
            "Account not found on Stellar testnet. Make sure your wallet is funded."
          );
        }
        throw new Error(`Horizon account lookup failed (HTTP ${accountRes.status})`);
      }

      const account = await accountRes.json();

      // Native XLM balance
      const nativeEntry = (account.balances as Array<{ asset_type: string; balance: string }>)
        .find((b) => b.asset_type === "native");
      const currentBalanceXlm = nativeEntry ? parseFloat(nativeEntry.balance) : 0;

      // ----------------------------------------------------------------
      // 2. Transactions — page through up to MAX_PAGES × PAGE_LIMIT txs
      //    Horizon returns them newest-first; we collect all to get counts.
      // ----------------------------------------------------------------
      let txCount       = 0;
      let failedTxCount = 0;
      let oldestDate: Date | null = null;
      const balanceSamples: number[] = [currentBalanceXlm];

      let nextUrl: string | null =
        `${HORIZON_URL}/accounts/${walletAddress}/transactions` +
        `?limit=${PAGE_LIMIT}&order=desc&include_failed=true`;

      for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
        const txRes: Response = await window.fetch(nextUrl);
        if (!txRes.ok) break;

        const txPage: { _embedded?: { records?: unknown[] }; _links?: { next?: { href?: string } } } = await txRes.json();
        const records: Array<{
          successful: boolean;
          created_at: string;
          fee_charged: string;
        }> = (txPage._embedded?.records ?? []) as Array<{
          successful: boolean;
          created_at: string;
          fee_charged: string;
        }>;

        if (records.length === 0) break;

        for (const tx of records) {
          if (tx.successful) {
            txCount++;
          } else {
            failedTxCount++;
          }

          // Track oldest transaction to derive account age
          const txDate = new Date(tx.created_at);
          if (!oldestDate || txDate < oldestDate) {
            oldestDate = txDate;
          }
        }

        // Horizon cursored pagination
        const nextLink: string | null = txPage._links?.next?.href ?? null;
        nextUrl = nextLink !== nextUrl ? nextLink : null;
      }

      // ----------------------------------------------------------------
      // 3. Derive months active from oldest seen transaction
      //    (Horizon doesn't expose exact account creation date directly,
      //    but the earliest transaction is a reliable proxy)
      // ----------------------------------------------------------------
      const now = new Date();
      let monthsActive = 0;

      if (oldestDate) {
        const msPerMonth = 1000 * 60 * 60 * 24 * 30.44;
        monthsActive = Math.floor(
          (now.getTime() - (oldestDate as Date).getTime()) / msPerMonth
        );
        monthsActive = Math.max(0, Math.min(monthsActive, 120)); // cap at 10 years
      }

      // ----------------------------------------------------------------
      // 4. Average balance
      //    We use the current balance as the primary sample.
      //    For a richer sample, fetch up to 5 recent payment effects
      //    and average their running balances.
      // ----------------------------------------------------------------
      try {
        const effectsRes = await window.fetch(
          `${HORIZON_URL}/accounts/${walletAddress}/effects` +
          `?limit=50&order=desc`
        );
        if (effectsRes.ok) {
          const effects = await effectsRes.json();
          const balanceEffects: Array<{
            type: string;
            amount: string;
            asset_type?: string;
          }> = (effects._embedded?.records ?? []).filter(
            (e: { type: string; asset_type?: string }) =>
              (e.type === "account_credited" || e.type === "account_debited") &&
              (!e.asset_type || e.asset_type === "native")
          );

          // Reconstruct a running balance going backwards from current
          let running = currentBalanceXlm;
          for (const effect of balanceEffects) {
            const amount = parseFloat(effect.amount);
            if (effect.type === "account_credited") {
              running -= amount; // undo the credit → earlier balance
            } else {
              running += amount; // undo the debit → earlier balance
            }
            if (running >= 0) {
              balanceSamples.push(running);
            }
          }
        }
      } catch {
        // Non-fatal — fall back to current balance only
      }

      const avgBalanceXlm =
        balanceSamples.reduce((sum, b) => sum + b, 0) / balanceSamples.length;

      const horizonData: HorizonData = {
        txCount,
        failedTxCount,
        avgBalanceXlm: Math.round(avgBalanceXlm * 100) / 100,
        monthsActive,
        currentBalanceXlm: Math.round(currentBalanceXlm * 100) / 100,
        accountCreatedAt: oldestDate
          ? (oldestDate as Date).toISOString()
          : null,
      };

      setData(horizonData);
      setState("done");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch wallet data from Horizon";
      setError(message);
      setState("error");
    }
  }, []);

  /**
   * Convert HorizonData into PrivateInputs for the ZK circuit.
   *
   * avgBalance is passed in "units" where 1 unit = 1000 stroops = 0.0001 XLM.
   * The circuit caps it at 10,000 units (≈ 1 XLM). Callers pass XLM directly;
   * we convert here to match the circuit's expected scaling.
   *
   * Circuit formula reference:
   *   score_proxy = txCapped*480 + cleanTxs*480 + ageCapped*1000 + balCapped
   *   where balCapped = min(avgBalance_units, 10_000)
   */
  const toPrivateInputs = useCallback(
    (horizonData: HorizonData, salt: string): PrivateInputs => {
      // avgBalance in "units" (XLM × 10 to give more resolution within the 10k cap)
      // 10,000 units ≈ 1,000 XLM — keeps real-world balances meaningful in circuit
      const avgBalanceUnits = Math.round(horizonData.avgBalanceXlm * 10);

      return {
        txCount:      horizonData.txCount,
        disputeCount: horizonData.failedTxCount,
        avgBalance:   avgBalanceUnits,
        monthsActive: horizonData.monthsActive,
        salt,
      };
    },
    []
  );

  const reset = useCallback(() => {
    setState("idle");
    setData(null);
    setError(null);
  }, []);

  return { state, data, error, fetch, toPrivateInputs, reset };
}
