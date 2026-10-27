import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Bot, CalendarDays, CheckCheck, ChevronDown, CreditCard, FolderKanban,
  LayoutDashboard, LogOut, Menu, Plus, Send, Settings, ShieldCheck, Sparkles, Users, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { get, post, formatDate, initials } from '../api.js';
import { Button, StatusBadge, useToast } from './ui.jsx';

const mainNav = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/studio', label: 'AI Studio', icon: Sparkles },
  { to: '/app/projects', label: 'Projects', icon: FolderKanban },
  { to: '/app/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/app/automation', label: 'Autopilot', icon: Bot },
  { to: '/app/publishing', label: 'Publishing', icon: Send },
  { to: '/app/accounts', label: 'Accounts', icon: Users },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/billing', label: 'Plans', icon: CreditCard },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { user, plan, providerStatus, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { data, reload } = useLoad(() => get('/api/notifications'), [], { refreshMs: 30000, initial: { notifications: [], unread: 0 } });
  const notifications = data?.notifications || [];
  const unread = data?.unread || 0;

  useEffect(() => { setMenuOpen(false); setProfileOpen(false); setNotificationsOpen(false); }, [location.pathname]);

  const nav = useMemo(() => [
    ...mainNav,
    ...(user?.role === 'admin' ? [{ to: '/app/admin', label: 'Admin', icon: ShieldCheck }] : []),
  ], [user?.role]);

  async function handleLogout() {
    try { await logout(); navigate('/login'); }
    catch (error) { showToast(error.message, 'error'); }
  }
  async function markRead(id) {
    try { await post(`/api/notifications/${id}/read`, {}); await reload({ silent: true }); }
    catch (error) { showToast(error.message, 'error'); }
  }
  async function markAllRead() {
    try { await post('/api/notifications/read-all', {}); await reload({ silent: true }); showToast('All notifications marked as read.', 'success'); }
    catch (error) { showToast(error.message, 'error'); }
  }

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div><strong>Faceless Studio</strong><span>AI content automation</span></div>
          <button className="icon-btn mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="side-nav">
          <div className="nav-section">Workspace</div>
          {nav.slice(0, 8).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <item.icon size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
          <div className="nav-section">Account</div>
          {nav.slice(8).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <item.icon size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="provider-dot-row">
            <span className={providerStatus?.ai?.configured ? 'status-dot good' : 'status-dot warn'} />
            <div><strong>{providerStatus?.ai?.configured ? 'Generation ready' : 'AI provider needs setup'}</strong><small>{providerStatus?.ai?.active || 'local'} mode</small></div>
          </div>
          <div className="plan-mini">
            <span>{plan?.name || 'Free'} plan</span>
            <StatusBadge status={user?.role === 'admin' ? 'active' : 'connected'} label={user?.role === 'admin' ? 'Admin' : 'Member'} />
          </div>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <div className="main-column">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="topbar-title">
            <span className="topbar-kicker">Workspace</span>
            <strong>{nav.find((item) => item.to === location.pathname)?.label || 'Faceless Studio'}</strong>
          </div>
          <div className="topbar-actions">
            <Button to="/app/studio" size="sm" variant="primary"><Plus size={16} /> New video</Button>
            <div className="popover-wrap">
              <button className="icon-btn notification-btn" onClick={() => setNotificationsOpen((v) => !v)} aria-label="Notifications">
                <Bell size={19} />{unread > 0 && <span className="notification-count">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {notificationsOpen && (
                <div className="popover notifications-popover">
                  <div className="popover-head"><strong>Notifications</strong><button className="text-btn" onClick={markAllRead}><CheckCheck size={14} /> Mark all</button></div>
                  <div className="notification-list">
                    {notifications.length === 0 && <div className="popover-empty">You’re all caught up.</div>}
                    {notifications.slice(0, 8).map((item) => {
                      const href = item.actionUrl?.startsWith('/') ? item.actionUrl : null;
                      return (
                        <div key={item.id} className={item.readAt ? 'notification-item' : 'notification-item unread'}>
                          <span className={`notification-dot ${item.type}`} />
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.body}</p>
                            <small>{formatDate(item.createdAt)}</small>
                          </div>
                          {!item.readAt && <button className="icon-btn tiny" onClick={() => markRead(item.id)} aria-label="Mark read"><CheckCheck size={14} /></button>}
                          {href && <NavLink to={href} className="notification-link" aria-label="Open"><ChevronDown size={14} className="rotate-left" /></NavLink>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="popover-wrap">
              <button className="profile-chip" onClick={() => setProfileOpen((v) => !v)}>
                <span className="avatar">{initials(user?.name)}</span>
                <span className="profile-meta"><strong>{user?.name || 'Creator'}</strong><small>{plan?.name || 'Free'} plan</small></span>
                <ChevronDown size={15} />
              </button>
              {profileOpen && (
                <div className="popover profile-popover">
                  <div className="profile-popover-head"><strong>{user?.name}</strong><span>{user?.email}</span></div>
                  <NavLink to="/app/settings" className="popover-link"><Settings size={16} /> Settings</NavLink>
                  <NavLink to="/app/billing" className="popover-link"><CreditCard size={16} /> Plans & billing</NavLink>
                  <button className="popover-link danger" onClick={handleLogout}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
        <nav className="mobile-bottom-nav">
          {nav.slice(0, 5).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
              <item.icon size={19} /><span>{item.label.split(' ')[0]}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
