import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { api, setSession, clearSession, getStoredUser, getToken, type AuthUser } from "../api/client";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  mustChangePassword: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [token, setToken] = useState<string | null>(getToken());
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser; mustChangePassword: boolean }>("/auth/login", {
      username,
      password,
    });
    setSession(res.token, res.user);
    setUser(res.user);
    setToken(res.token);
    setMustChangePassword(res.mustChangePassword);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setToken(null);
  }, []);

  const clearMustChangePassword = useCallback(() => setMustChangePassword(false), []);

  return (
    <AuthContext.Provider value={{ user, token, mustChangePassword, login, logout, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
