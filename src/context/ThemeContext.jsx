import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const THEMES = [
  { id: 'system', label: 'System', description: 'Follow your device appearance', swatch: 'linear-gradient(135deg, #1a2240 50%, #f4f7fc 50%)' },
  { id: 'midnight', label: 'Midnight', description: 'Deep violet studio theme', swatch: 'linear-gradient(135deg, #8b7cff, #42d9d0)' },
  { id: 'daylight', label: 'Daylight', description: 'Bright professional workspace', swatch: 'linear-gradient(135deg, #ffffff, #6c5ce7)' },
  { id: 'aurora', label: 'Aurora', description: 'High-contrast teal dark theme', swatch: 'linear-gradient(135deg, #21d4a8, #4fd1ff)' },
];

const STORAGE_KEY = 'faceless-studio-theme';
const ThemeContext = createContext(null);

function systemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'midnight';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'midnight';
}
function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.some((theme) => theme.id === stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);
  const [systemResolved, setSystemResolved] = useState(systemTheme);
  const resolvedTheme = theme === 'system' ? systemResolved : theme;

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = (event) => setSystemResolved(event.matches ? 'daylight' : 'midnight');
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = theme;
    root.style.colorScheme = resolvedTheme === 'daylight' ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    const colors = { midnight: '#080b16', daylight: '#f5f7fb', aurora: '#041318' };
    if (meta) meta.setAttribute('content', colors[resolvedTheme] || colors.midnight);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage can be disabled */ }
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((next) => {
    if (THEMES.some((item) => item.id === next)) setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme, themes: THEMES }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
