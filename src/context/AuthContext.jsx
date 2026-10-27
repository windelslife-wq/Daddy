import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post } from '../api.js';

const AuthContext = createContext(null);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const [auth, meta] = await Promise.all([
      get('/api/auth/session').catch(() => ({ authenticated: false, user: null })),
      get('/api/meta/options').catch(() => null),
    ]);
    setSession(auth);
    if (meta) setOptions(meta);
    else if (auth?.providerStatus) setOptions({ providerStatus: auth.providerStatus, platforms: {}, niches: [], styles: [], languages: [], voices: [], aspects: [], tones: [] });
    setError(null);
    return auth;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { await refresh(); }
      catch (err) { if (alive) setError(err); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const result = await post('/api/auth/login', { email, password });
    await refresh();
    return result;
  }, [refresh]);

  const register = useCallback(async (name, email, password) => {
    const result = await post('/api/auth/register', { name, email, password });
    await refresh();
    return result;
  }, [refresh]);

  const logout = useCallback(async () => {
    await post('/api/auth/logout', {});
    await refresh();
  }, [refresh]);

  const value = useMemo(() => ({
    loading,
    error,
    authenticated: Boolean(session?.authenticated),
    user: session?.user || null,
    plan: session?.plan || null,
    usage: session?.usage || null,
    providerStatus: session?.providerStatus || options?.providerStatus || null,
    options: options || { niches: [], styles: [], languages: [], voices: [], aspects: [], tones: [], platforms: {} },
    session,
    refresh,
    login,
    register,
    logout,
  }), [loading, error, session, options, refresh, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
