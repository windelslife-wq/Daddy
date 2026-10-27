import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const THEME_ICONS = { system: 'monitor', midnight: 'moon', daylight: 'sun', aurora: 'palette' };

export function ThemeSwitcher({ compact = false, align = 'right', className = '' }) {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = themes.find((item) => item.id === theme) || themes[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`theme-switcher ${className}`} data-align={align}>
      <button
        type="button"
        className={`theme-trigger ${compact ? 'compact' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Appearance: ${current.label}. Change theme`}
        title="Change appearance"
      >
        <Icon name={THEME_ICONS[theme] || 'palette'} size={17} />
        {!compact && <span>{current.label}</span>}
        <Icon name="chevron-down" size={14} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Appearance theme">
          <div className="theme-menu-head">
            <strong>Appearance</strong>
            <span>Applies to every page</span>
          </div>
          {themes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === item.id}
              className={`theme-option ${theme === item.id ? 'active' : ''}`}
              onClick={() => { setTheme(item.id); setOpen(false); }}
            >
              <span className="theme-swatch" style={{ background: item.swatch }} />
              <span className="theme-option-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              {theme === item.id && <Icon name="check" size={16} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ThemeSwitcher;
