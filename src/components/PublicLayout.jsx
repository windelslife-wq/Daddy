import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { NAV_GROUPS, PRIMARY_NAV, SITE } from '../config/site.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Icon } from './Icon.jsx';
import { Footer } from './Footer.jsx';
import { ThemeSwitcher } from './ThemeSwitcher.jsx';

function NavIcon({ name }) {
  return <Icon name={name} size={17} />;
}

function ExploreMenu({ mobile = false }) {
  if (!mobile) {
    return (
      <details className="nav-dropdown">
        <summary aria-label="Explore all pages">Explore <Icon name="chevron-down" size={14} /></summary>
        <div className="mega-menu">
          <div className="mega-menu-intro">
            <span className="eyebrow">Complete site map</span>
            <h3>Everything in one place</h3>
            <p>Product details, implementation guides, support, company information, and policies.</p>
            <Link to="/docs" className="text-link">Start with the docs <Icon name="arrow-right" size={14} /></Link>
          </div>
          <div className="mega-menu-groups">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="mega-menu-group">
                <h4>{group.label}</h4>
                {group.links.map((page) => (
                  <Link key={page.path} to={page.path} className="mega-link">
                    <NavIcon name={page.icon} /><span>{page.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      </details>
    );
  }
  return (
    <div className="mobile-nav-groups">
      {NAV_GROUPS.map((group) => (
        <section key={group.id} className="mobile-nav-group">
          <h3>{group.label}</h3>
          {group.links.map((page) => (
            <NavLink key={page.path} to={page.path} className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>
              <NavIcon name={page.icon} /><span>{page.label}</span><Icon name="chevron-right" size={14} />
            </NavLink>
          ))}
        </section>
      ))}
    </div>
  );
}

export function PublicLayout({ children = null }) {
  const { authenticated } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', mobileOpen);
    return () => document.body.classList.remove('nav-open');
  }, [mobileOpen]);

  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="container site-header-inner">
          <Link to="/" className="brand" aria-label={`${SITE.name} home`}>
            <span className="brand-mark"><Icon name="sparkles" size={18} /></span>
            <span className="brand-copy"><strong>{SITE.name}</strong><small>Creator operations</small></span>
          </Link>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {PRIMARY_NAV.map((page) => (
              <NavLink key={page.path} to={page.path} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{page.label}</NavLink>
            ))}
            <ExploreMenu />
          </nav>
          <div className="site-header-actions">
            <ThemeSwitcher compact />
            {authenticated ? (
              <Link to="/app" className="btn btn-primary btn-sm">Open studio <Icon name="arrow-right" size={15} /></Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm header-login">Sign in</Link>
                <Link to="/signup" className="btn btn-primary btn-sm header-signup">Get started <Icon name="arrow-right" size={15} /></Link>
              </>
            )}
            <button
              type="button"
              className="icon-btn mobile-nav-toggle"
              onClick={() => setMobileOpen((value) => !value)}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileOpen}
            >
              <Icon name={mobileOpen ? 'x' : 'menu'} size={21} />
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="mobile-nav-panel">
            <div className="container">
              <div className="mobile-nav-primary">
                {PRIMARY_NAV.map((page) => (
                  <NavLink key={page.path} to={page.path} className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}>
                    <NavIcon name={page.icon} /><span>{page.label}</span><Icon name="chevron-right" size={14} />
                  </NavLink>
                ))}
              </div>
              <ExploreMenu mobile />
              <div className="mobile-nav-actions">
                <ThemeSwitcher />
                {authenticated
                  ? <Link to="/app" className="btn btn-primary">Open studio</Link>
                  : <><Link to="/login" className="btn btn-secondary">Sign in</Link><Link to="/signup" className="btn btn-primary">Create account</Link></>}
              </div>
            </div>
          </div>
        )}
      </header>
      <main id="main-content" className="site-main">{children || <Outlet />}</main>
      <Footer />
    </div>
  );
}

export default PublicLayout;
