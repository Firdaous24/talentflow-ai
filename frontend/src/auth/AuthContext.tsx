import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AuthApiError, authApi } from "./api";
import type { Account } from "./api";

/** `reason` tells the account page where to go once a person signs out or deletes the account. */
type AuthState = { status: "loading" } | { status: "anonymous"; reason?: "signed_out" | "deleted" } | { status: "authenticated"; account: Account } | { status: "unavailable"; error: AuthApiError };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<Account>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  setAccount: (account: Account) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Mounted only around the public and account pages: the demo workbench never calls /api/v2. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((account) => active && setState({ status: "authenticated", account }))
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof AuthApiError && error.status === 401) setState({ status: "anonymous" });
        else setState({ status: "unavailable", error: error instanceof AuthApiError ? error : new AuthApiError(0, "network", "Network error") });
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const account = await authApi.login(email, password);
    setState({ status: "authenticated", account });
    return account;
  }, []);
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setState({ status: "anonymous", reason: "signed_out" });
    }
  }, []);
  const deleteAccount = useCallback(async (password: string) => {
    await authApi.deleteAccount(password);
    setState({ status: "anonymous", reason: "deleted" });
  }, []);
  const setAccount = useCallback((account: Account) => setState({ status: "authenticated", account }), []);

  const value = useMemo(() => ({ state, login, logout, deleteAccount, setAccount }), [state, login, logout, deleteAccount, setAccount]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
