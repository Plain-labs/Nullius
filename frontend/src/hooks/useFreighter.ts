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

// freighter-api v2 returns primitives directly; v1 returned wrapped objects.
// These helpers normalize both shapes so the hook works with either version.
async function getIsConnected(): Promise<boolean> {
  const res = await (isConnected() as Promise<unknown>);
  if (typeof res === "boolean") return res;
  if (res && typeof res === "object" && "isConnected" in res) {
    return !!(res as { isConnected: boolean }).isConnected;
  }
  return false;
}

async function getWalletPublicKey(): Promise<string> {
  const res = await (getPublicKey() as Promise<unknown>);
  if (typeof res === "string") return res;
  if (res && typeof res === "object" && "publicKey" in res) {
    return (res as { publicKey: string }).publicKey ?? "";
  }
  return "";
}

async function signTx(xdr: string): Promise<string> {
  const res = await (signTransaction(xdr, {
    networkPassphrase: "Test SDF Network ; September 2015",
  }) as Promise<unknown>);
  if (typeof res === "string") return res;
  if (res && typeof res === "object" && "signedTxXdr" in res) {
    return (res as { signedTxXdr: string }).signedTxXdr ?? "";
  }
  return "";
}

export function useFreighter() {
  const [state, setState] = useState<FreighterState>({
    connected: false,
    publicKey: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    getIsConnected()
      .then((c) => {
        if (c) {
          getWalletPublicKey()
            .then((publicKey) =>
              setState({ connected: true, publicKey, loading: false, error: null })
            )
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
      const publicKey = await getWalletPublicKey();
      if (!publicKey) {
        throw new Error("Freighter not found or access denied. Please install the Freighter extension.");
      }
      setState({ connected: true, publicKey, loading: false, error: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const sign = useCallback(async (xdr: string) => {
    return signTx(xdr);
  }, []);

  return { ...state, connect, sign };
}
