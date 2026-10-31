import React, { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, CheckCheck, ChevronDown, CreditCard, LogOut, Menu, Plus, Settings, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks.js';
import { get, post, formatDate, initials } from '../api.js';
import { APP_PAGES, FILM_PAGES, NAV_GROUPS, SITE } from '../config/site.js';
import { Icon } from './Icon.jsx';
import { BrandMark } from './BrandMark.jsx';
import { Button, StatusBadge, useToast } from './ui.jsx';
import { Footer } from './Footer.jsx';
import { ThemeSwitcher } from './ThemeSwitcher.jsx';

const mainNav = APP_PAGES.map((page) => ({
  to: page.path,
  label: page.label,
  icon: page.icon,
  admin: Boolean(page.admin),
  end: page.path === '/app',
}));

function WebsiteMenu({ compact = false }) {
  return (
    <div className={compact ? 'app-explore-groups' : 'side-website-groups'}>
      {NAV_GROUPS.map((group) => (
        <div className={compact ? 'app-explore-group' : 'side-website-group'} key={group.id}>
          <strong>{group.label}</strong>
          {group.links.map((page) => (
            <Link key={page.path} to={page.path} className={compact ? 'app-explore-link' : 'side-website-link'}>
              <Icon name={page.icon} size={14} /><span>{page.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Layout() {
  const { user, plan, providerStatus, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [websiteOpen, setWebsiteOpen] = useState(false);
  const { data, reload } = useLoad(() => get('/api/notifications'), [], { refreshMs: 30000, initial: { notifications: [], unread: 0 } });
  const notifications = data?.notifications || [];
  const unread = data?.unread || 0;

  useEffect(() => {
    setMenuOpen(false); setProfileOpen(false); setNotificationsOpen(false); setWebsiteOpen(false);
  }, [location.pathname]);

  const nav = useMemo(() => mainNav.filter((item) => !item.admin || user?.role === 'admin'), [user?.role]);
  const currentPage = useMemo(() => [...nav.map((item) => ({ ...item, path: item.to })), ...FILM_PAGES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)), [nav, location.pathname]);

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
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark"><BrandMark size={38} /></div>
          <div><strong>{SITE.name}</strong><span>AI content automation</span></div>
          <button className="icon-btn mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="side-nav">
          <div className="nav-section">Workspace</div>
          {nav.slice(0, 8).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
          <div className="nav-section">AI Filmmaking</div>
          {FILM_PAGES.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === '/app/films'} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
          <div className="nav-section">Account</div>
          {nav.slice(8).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
          <div className="nav-section">Website</div>
          <Link to="/" className="nav-link"><Icon name="home" size={18} /><span>Public home</span></Link>
          <details className="side-website-nav" open={websiteOpen} onToggle={(event) => setWebsiteOpen(event.currentTarget.open)}>
            <summary className="nav-link"><Icon name="globe" size={18} /><span>All site pages</span><Icon name="chevron-down" size={15} className="summary-chevron" /></summary>
            <WebsiteMenu />
          </details>
          <Link to="/sitemap" className="nav-link"><Icon name="list-checks" size={18} /><span>Sitemap</span></Link>
          <Link to="/help" className="nav-link"><Icon name="help" size={18} /><span>Help Center</span></Link>
          <Link to="/contact" className="nav-link"><Icon name="mail" size={18} /><span>Contact</span></Link>
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
          <div className="sidebar-theme"><span>Appearance</span><ThemeSwitcher compact /></div>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <div className="main-column">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="topbar-title">
            <span className="topbar-kicker">Workspace</span>
            <strong>{currentPage?.label || SITE.name}</strong>
          </div>
          <div className="topbar-actions">
            <details className="app-explore">
              <summary className="btn btn-ghost btn-sm"><Icon name="globe" size={15} /> Website <ChevronDown size={13} /></summary>
              <div className="app-explore-menu"><div className="app-explore-head"><strong>Complete site map</strong><span>All pages are available in your active theme.</span></div><WebsiteMenu compact /></div>
            </details>
            <ThemeSwitcher compact />
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
                  <Link to="/" className="popover-link"><Icon name="home" size={16} /> Public website</Link>
                  <Link to="/help" className="popover-link"><Icon name="help" size={16} /> Help Center</Link>
                  <div className="popover-theme-row"><span>Appearance</span><ThemeSwitcher compact /></div>
                  <button className="popover-link danger" onClick={handleLogout}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="workspace-content" className="page-content"><Outlet /></main>
        <Footer compact />
        <nav className="mobile-bottom-nav">
          {nav.slice(0, 5).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon name={item.icon} size={19} /><span>{item.label.split(' ')[0]}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
