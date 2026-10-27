import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, Loader2, X, Zap } from 'lucide-react';

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

const ToastContext = createContext({ showToast: () => {} });
export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const showToast = (message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, message, type }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5000);
  };
  const value = useMemo(() => ({ showToast }), []);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={cx('toast', `toast-${toast.type}`)}>
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : toast.type === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
            <span>{toast.message}</span>
            <button aria-label="Dismiss" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function Button({ children, variant = 'primary', size = 'md', className = '', href, to, external = false, ...props }) {
  const classes = cx('btn', `btn-${variant}`, `btn-${size}`, className);
  if (to) return <Link to={to} className={classes} {...props}>{children}</Link>;
  if (href) return <a href={href} className={classes} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} {...props}>{children}</a>;
  return <button className={classes} {...props}>{children}</button>;
}

const statusLabels = {
  queued: 'Queued', generating: 'Generating', completed: 'Ready', failed: 'Failed',
  draft: 'Draft', scheduled: 'Scheduled', needs_review: 'Needs review', pending_review: 'Pending review',
  awaiting_media: 'Awaiting video', publishing: 'Publishing', processing: 'Processing',
  published: 'Published', skipped: 'Skipped', partial: 'Partial', connected: 'Connected',
  disconnected: 'Disconnected', expired: 'Token expired', active: 'Active', suspended: 'Suspended',
};
const statusTones = {
  queued: 'neutral', generating: 'info', completed: 'success', published: 'success', connected: 'success', active: 'success',
  failed: 'danger', expired: 'danger', suspended: 'danger', publishing: 'info', processing: 'info', scheduled: 'info',
  needs_review: 'warning', pending_review: 'warning', awaiting_media: 'warning', partial: 'warning',
  draft: 'neutral', skipped: 'neutral', disconnected: 'neutral',
};
export function StatusBadge({ status, label, className = '' }) {
  const key = String(status || 'unknown').toLowerCase();
  return <span className={cx('badge', `badge-${statusTones[key] || 'neutral'}`, className)}>{label || statusLabels[key] || key.replaceAll('_', ' ')}</span>;
}

export function Card({ children, className = '', title, subtitle, action, icon: Icon, ...props }) {
  return (
    <section className={cx('card', className)} {...props}>
      {(title || action || Icon) && (
        <div className="card-head">
          <div className="card-title-row">
            {Icon && <span className="card-icon"><Icon size={18} /></span>}
            <div>
              {title && <h2 className="card-title">{title}</h2>}
              {subtitle && <p className="card-subtitle">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, actions, children }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function ProgressBar({ value = 0, label, tone = 'primary', compact = false }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={cx('progress-wrap', compact && 'compact')}>
      {(label || !compact) && <div className="progress-label"><span>{label || 'Progress'}</span><strong>{pct}%</strong></div>}
      <div className="progress-track"><div className={cx('progress-fill', `fill-${tone}`)} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function QuotaBar({ label, used = 0, limit = 0, suffix = '' }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="quota">
      <div className="quota-head"><span>{label}</span><span>{used.toLocaleString()} / {limit.toLocaleString()} {suffix}</span></div>
      <div className="progress-track small"><div className={cx('progress-fill', pct > 85 ? 'fill-danger' : 'fill-primary')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function Spinner({ size = 18, label }) {
  return <span className="spinner"><Loader2 className="spin" size={size} />{label && <span>{label}</span>}</span>;
}

export function EmptyState({ icon: Icon = Zap, title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '', required = false }) {
  return (
    <label className={cx('field', className)}>
      <span className="field-label">{label}{required && <em> *</em>}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={cx('toggle-row', disabled && 'disabled')}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </label>
  );
}

export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={cx('tabs', className)} role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={active === tab.id} className={cx('tab', active === tab.id && 'active')} onClick={() => onChange(tab.id)}>
          {tab.icon && <tab.icon size={16} />}{tab.label}
          {tab.count != null && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function KeyValue({ items = [], columns = 2 }) {
  return (
    <div className="key-value" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map(([key, value]) => <div key={key} className="kv-item"><span>{key}</span><strong>{value ?? '—'}</strong></div>)}
    </div>
  );
}

export function ErrorBanner({ error, onRetry, title = 'Something needs attention' }) {
  if (!error) return null;
  return (
    <div className="banner banner-error">
      <AlertCircle size={18} />
      <div><strong>{title}</strong><span>{error?.message || String(error)}</span></div>
      {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function InfoBanner({ children, tone = 'info', icon: Icon = Info, action }) {
  return (
    <div className={cx('banner', `banner-${tone}`)}>
      <Icon size={18} />
      <div>{children}</div>
      {action}
    </div>
  );
}
