/**
 * useFreighter
 *
 * Manages Freighter wallet connection state for the Nullius frontend.
 *
 * Features:
 *   - Auto-detects existing connection on mount (no popup on page load)
 *   - Explicit connect() triggers Freighter's access approval popup
 *   - Network validation: warns when wallet is not on Testnet
 *   - disconnect() clears local state (Freighter has no revoke API)
 *   - Polls for account changes every 3s while connected, so switching
 *     accounts in Freighter is reflected automatically
 *   - All freighter-api v2 return types used directly — no `unknown` casts
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  isConnected,
  getPublicKey,
  requestAccess,
  getNetworkDetails,
} from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

const EXPECTED_PASSPHRASE = Networks.TESTNET;
const POLL_INTERVAL_MS    = 3_000;

export type WalletStatus =
  | "idle"        // not yet checked
  | "checking"    // auto-detecting on mount
  | "connecting"  // user clicked Connect
  | "connected"   // wallet connected and on correct network
  | "wrong-network" // connected but wrong network
  | "disconnected"; // was connected, now not (or user disconnected)

export interface FreighterState {
  status: WalletStatus;
  /** Shorthand — true only when status === "connected" */
  connected: boolean;
  publicKey: string | null;
  /** Human-readable network name, e.g. "TESTNET" */
  network: string | null;
  /** True when wallet is connected but not on Testnet */
  wrongNetwork: boolean;
  /** True during any async operation */
  loading: boolean;
  /** User-facing error message, null when no error */
  error: string | null;
}

const INITIAL: FreighterState = {
  status:       "idle",
  connected:    false,
  publicKey:    null,
  network:      null,
  wrongNetwork: false,
  loading:      true,
  error:        null,
};

export function useFreighter() {
  const [state, setState] = useState<FreighterState>(INITIAL);
  const pollRef           = useRef<ReturnType<typeof setInterval> | null>(null);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * Fetch the current public key and network details, then update state.
   * Called both on connect and during the polling loop.
   * Returns true if still connected, false if the wallet has been locked.
   */
  const syncWalletState = useCallback(async (): Promise<boolean> => {
    try {
      const [pk, netDetails] = await Promise.all([
        getPublicKey(),
        getNetworkDetails(),
      ]);

      if (!pk) {
        // Wallet locked or access revoked since last check
        setState((s) => ({
          ...s,
          status:       "disconnected",
          connected:    false,
          publicKey:    null,
          network:      null,
          wrongNetwork: false,
          loading:      false,
          error:        null,
        }));
        return false;
      }

      const isCorrectNetwork =
        netDetails.networkPassphrase === EXPECTED_PASSPHRASE;

      setState((s) => ({
        ...s,
        status:       isCorrectNetwork ? "connected" : "wrong-network",
        connected:    isCorrectNetwork,
        publicKey:    pk,
        network:      netDetails.network || null,
        wrongNetwork: !isCorrectNetwork,
        loading:      false,
        error:        isCorrectNetwork
          ? null
          : `Switch Freighter to Testnet (currently on ${netDetails.network || "unknown network"})`,
      }));

      return true;
    } catch {
      return false;
    }
  }, []);

  // ----------------------------------------------------------------
  // On mount: silently check if already connected (no popup)
  // ----------------------------------------------------------------
  useEffect(() => {
    setState((s) => ({ ...s, status: "checking", loading: true }));

    isConnected()
      .then(async (already) => {
        if (already) {
          await syncWalletState();
        } else {
          setState((s) => ({
            ...s,
            status:  "disconnected",
            loading: false,
          }));
        }
      })
      .catch(() => {
        setState((s) => ({
          ...s,
          status:  "disconnected",
          loading: false,
          error:
            "Freighter not detected. Install the browser extension from freighter.app",
        }));
      });

    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------
  // Poll for account / network changes while connected
  // ----------------------------------------------------------------
  useEffect(() => {
    if (state.status === "connected" || state.status === "wrong-network") {
      stopPolling();
      pollRef.current = setInterval(async () => {
        const stillConnected = await syncWalletState();
        if (!stillConnected) stopPolling();
      }, POLL_INTERVAL_MS);
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [state.status, syncWalletState, stopPolling]);

  // ----------------------------------------------------------------
  // connect() — triggers Freighter popup, then syncs state
  // ----------------------------------------------------------------
  const connect = useCallback(async () => {
    setState((s) => ({
      ...s,
      status:  "connecting",
      loading: true,
      error:   null,
    }));

    try {
      // requestAccess() opens the Freighter approval popup and returns the
      // public key once the user approves. On v2 it returns "" on rejection.
      const pk = await requestAccess();

      if (!pk) {
        setState((s) => ({
          ...s,
          status:  "disconnected",
          loading: false,
          error:   "Access denied. Click 'Connect Freighter' and approve in the popup.",
        }));
        return;
      }

      // Now sync full state including network check
      await syncWalletState();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to connect to Freighter";

      const isNotInstalled =
        message.toLowerCase().includes("freighter") === false &&
        message.toLowerCase().includes("extension") === false
          ? "Freighter not found. Install the browser extension from freighter.app"
          : message;

      setState((s) => ({
        ...s,
        status:  "disconnected",
        loading: false,
        error:   isNotInstalled,
      }));
    }
  }, [syncWalletState]);

  // ----------------------------------------------------------------
  // disconnect() — clears local state only
  // Freighter has no API to revoke access programmatically; the user
  // can revoke from within the extension settings.
  // ----------------------------------------------------------------
  const disconnect = useCallback(() => {
    stopPolling();
    setState({
      ...INITIAL,
      status:  "disconnected",
      loading: false,
    });
  }, [stopPolling]);

  return {
    // Full state
    ...state,
    // Actions
    connect,
    disconnect,
  };
}
