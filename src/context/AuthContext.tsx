/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi, User, SESSION_EXPIRED_EVENT } from '@/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        try {
          const userData = await authApi.getProfile();
          setUser(userData);
          setToken(storedToken);
        } catch {
          logout();
        }
      }
      setIsLoading(false);
    };

    initAuth();
    // Deliberately empty deps (matches the original): this must only ever
    // run once, on mount - logout() is stable (useCallback, no deps) so
    // including it wouldn't change that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 20: centralized session-expiry handling. src/api/index.ts's
  // request() dispatches this exact event the moment any
  // authenticate()-required API call comes back 401 for a token this app
  // sent - this is the one place that reacts to it, rather than every
  // page handling its own 401s. Clearing user/token here is enough on its
  // own: every protected page is already wrapped in <ProtectedRoute>,
  // which redirects to /login the instant isAuthenticated goes false on
  // its next render (see ProtectedRoute.tsx) - no separate navigate() call
  // or redirect-loop guard is needed here, since that redirect only ever
  // fires *from* a protected page *to* /login, never the reverse.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
  }, [logout]);

  // Phase 24: cross-tab sync. localStorage is shared across every tab on
  // the same origin, but React state is not - without this, logging in or
  // out in one tab left every other open tab showing stale authenticated
  // (or unauthenticated) UI until its next API call or a full reload. The
  // browser's own 'storage' event is the right primitive for this: per
  // spec it fires only in *other* tabs/documents than the one that made
  // the change, never in the tab that called setItem/removeItem itself -
  // so reacting to it here cannot loop back on the tab that triggered it.
  //
  // This deliberately does not add a second logout/expiry mechanism. It
  // reacts, in other tabs, to the exact same localStorage.removeItem
  // ('token') that logout() (above) and the 401 handler in
  // src/api/index.ts already perform - including the removal that
  // happens right before SESSION_EXPIRED_EVENT is dispatched, which is
  // same-tab-only and therefore never reaches other tabs on its own. The
  // 'storage' event is simply the transport that makes those other tabs
  // notice. Suspension/rejection/password-reset invalidation are not (and
  // must not be) detected this way - those are only ever discovered when
  // a tab makes its own next authenticated API request, which the
  // existing backend re-check (see middleware/auth.ts) and the 401
  // pipeline above already handle correctly regardless of this effect.
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== 'token') {
        return;
      }

      if (!event.newValue) {
        // Another tab logged out, or its session expired.
        logout();
        return;
      }

      if (event.newValue !== event.oldValue) {
        // Another tab logged in with a new token - adopt it here too,
        // rather than waiting for this tab's own next reload/API call.
        setToken(event.newValue);
        authApi
          .getProfile()
          .then(setUser)
          .catch(() => logout());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [logout]);

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    localStorage.setItem('token', response.token);
    setToken(response.token);
    setUser(response.user);
    return response.user;
  };

  const updateUser = (userData: User) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        login,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

