import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setApiToken, setUnauthorizedHandler } from "@/api";
import { clearPending, clearToken, loadToken, saveToken } from "@/storage";
import type { PublicConfig, User } from "@/types";

type AuthValue = {
  ready: boolean;
  user: User | null;
  config: PublicConfig | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshConfig: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setApiToken(null);
      setUser(null);
      void clearToken();
    });
    let cancelled = false;
    (async () => {
      try {
        const nextConfig = await api.config();
        if (!cancelled) setConfig(nextConfig);
      } catch {
        if (!cancelled) setConfig(null);
      }
      try {
        const stored = await loadToken();
        if (!stored) return;
        setApiToken(stored);
        const me = await api.me();
        if (!cancelled) setUser(me.user);
      } catch {
        setApiToken(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user,
      config,
      async signIn(email, password) {
        const result = await api.login({ email: email.trim(), password });
        setApiToken(result.token);
        await saveToken(result.token);
        setUser(result.user);
      },
      async register(name, email, password) {
        const result = await api.register({ name: name.trim(), email: email.trim(), password });
        setApiToken(result.token);
        await saveToken(result.token);
        setUser(result.user);
      },
      async signOut() {
        setApiToken(null);
        setUser(null);
        await clearToken();
        await clearPending();
      },
      async refreshConfig() {
        setConfig(await api.config());
      },
    }),
    [ready, user, config],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
