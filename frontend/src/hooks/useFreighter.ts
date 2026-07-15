import { useState, useEffect, useCallback } from "react";
import {
  isConnected,
  getPublicKey,
  signTransaction,
} from "@stellar/freighter-api";

interface FreighterState {
  connected: boolean;
  publicKey: string | null;
  loading: boolean;
  error: string | null;
}

export function useFreighter() {
  const [state, setState] = useState<FreighterState>({
    connected: false,
    publicKey: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    // freighter-api v2: isConnected() returns boolean directly
    (isConnected() as unknown as Promise<boolean | { isConnected: boolean }>)
      .then((res) => {
        const c = typeof res === "boolean" ? res : res.isConnected;
        if (c) {
          (getPublicKey() as unknown as Promise<string | { publicKey: string }>)
            .then((pkRes) => {
              const publicKey = typeof pkRes === "string" ? pkRes : pkRes.publicKey;
              setState({ connected: true, publicKey, loading: false, error: null });
            })
            .catch(() => setState((s) => ({ ...s, loading: false })));
        } else {
          setState((s) => ({ ...s, loading: false }));
        }
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const pkRes = await (getPublicKey() as unknown as Promise<string | { publicKey: string }>);
      const publicKey = typeof pkRes === "string" ? pkRes : pkRes.publicKey;
      if (!publicKey) throw new Error("Freighter not found or access denied. Please install the Freighter extension.");
      setState({ connected: true, publicKey, loading: false, error: null });
    } catch (e: any) {
      setState((s) => ({ ...s, loading: false, error: e?.message ?? String(e) }));
    }
  }, []);

  const sign = useCallback(async (xdr: string) => {
    const result = await (signTransaction(xdr, {
      networkPassphrase: "Test SDF Network ; September 2015",
    }) as unknown as Promise<string | { signedTxXdr: string }>);
    return typeof result === "string" ? result : result.signedTxXdr;
  }, []);

  return { ...state, connect, sign };
}
