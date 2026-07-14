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
    isConnected().then(({ isConnected: c }) => {
      if (c) {
        getPublicKey().then(({ publicKey }) => {
          setState({ connected: true, publicKey, loading: false, error: null });
        });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    });
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { publicKey } = await getPublicKey();
      setState({ connected: true, publicKey, loading: false, error: null });
    } catch (e: any) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  const sign = useCallback(
    async (xdr: string) => {
      const result = await signTransaction(xdr, {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      return result.signedTxXdr;
    },
    []
  );

  return { ...state, connect, sign };
}
