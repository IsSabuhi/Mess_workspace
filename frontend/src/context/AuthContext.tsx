import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { UserMe } from "../api/auth";
import { ApiError } from "../api/client";
import { fetchMe, loginJson, logout, logoutRequest } from "../api/auth";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: UserMe };

type AuthContextValue = {
  state: AuthState;
  refresh: () => Promise<void>;
  /** Подставить пользователя из ответа API (например PATCH /me) без повторного GET — актуальные данные сразу в UI */
  setAuthenticatedUser: (user: UserMe) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const user = await fetchMe();
      setState({ status: "authenticated", user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        setState({ status: "anonymous" });
        return;
      }
      logout();
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    await loginJson(email, password);
    const user = await fetchMe();
    setState({ status: "authenticated", user });
  }, []);

  const signOut = useCallback(() => {
    void logoutRequest();
    logout();
    setState({ status: "anonymous" });
  }, []);

  const setAuthenticatedUser = useCallback((user: UserMe) => {
    setState({ status: "authenticated", user });
  }, []);

  const value = useMemo(
    () => ({ state, refresh, setAuthenticatedUser, signIn, signOut }),
    [state, refresh, setAuthenticatedUser, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
