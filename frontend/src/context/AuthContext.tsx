import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { UserMe } from "../api/auth";
import { ApiError, setUnauthorizedHandler } from "../api/client";
import { fetchMe, loginJson, logoutRequest } from "../api/auth";
import { queryClient } from "../lib/queryClient";

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
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    try {
      const user = await fetchMe();
      setState({ status: "authenticated", user });
    } catch (e) {
      const transient = e instanceof ApiError && (e.isNetworkError || e.status >= 500);
      // Сервер прилёг или пропала сеть: не выкидываем из уже открытой сессии,
      // иначе пользователь теряет несохранённую работу из-за секундного сбоя.
      if (transient && stateRef.current.status === "authenticated") return;
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Сессия окончательно истекла на любом запросе — сразу показываем экран входа.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (stateRef.current.status === "anonymous") return;
      setState({ status: "anonymous" });
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await loginJson(email, password);
    const user = await fetchMe();
    setState({ status: "authenticated", user });
  }, []);

  const signOut = useCallback(async () => {
    // Дожидаемся ответа: сервер отзывает refresh-сессию и чистит куки.
    try {
      await logoutRequest();
    } catch {
      /* даже при сбое переводим UI в анонимное состояние */
    }
    setState({ status: "anonymous" });
    // Иначе данные прошлого пользователя останутся в кэше до перезагрузки страницы.
    queryClient.clear();
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
