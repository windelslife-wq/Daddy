import React from 'react';
import { Link } from 'react-router-dom';
import { FOOTER_GROUPS, SITE } from '../config/site.js';
import { Icon } from './Icon.jsx';
import { ThemeSwitcher } from './ThemeSwitcher.jsx';

export function Footer({ compact = false }) {
  return (
    <footer className={`site-footer ${compact ? 'compact' : ''}`}>
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <Link to="/" className="brand footer-brand-link" aria-label={`${SITE.name} home`}>
              <span className="brand-mark"><Icon name="sparkles" size={18} /></span>
              <span className="brand-copy"><strong>{SITE.name}</strong>{!compact && <small>{SITE.tagline}</small>}</span>
            </Link>
            {!compact && <p className="footer-description">{SITE.description} Built for original content and official platform APIs.</p>}
            <div className="footer-badges">
              <span><Icon name="shield-check" size={14} /> Secure by design</span>
              <span><Icon name="webhook" size={14} /> Official APIs</span>
            </div>
          </div>
          <div className="footer-links">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.id} className="footer-column" aria-label={`${group.label} links`}>
                <h3>{group.label}</h3>
                <ul>
                  {group.links.map((page) => (
                    <li key={page.path}><Link to={page.path}>{page.label}</Link></li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</span>
          <div className="footer-bottom-links">
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Create account</Link>
            <Link to="/sitemap">Workspace &amp; site map</Link>
            <Link to="/status"><span className="status-pulse" /> Service status</Link>
            <a href={`mailto:${SITE.email}`}><Icon name="mail" size={13} /> {SITE.email}</a>
            <ThemeSwitcher compact align="left" />
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
