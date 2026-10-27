import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import PublicLayout from '../components/PublicLayout.jsx';
import { NAV_GROUPS } from '../config/site.js';

export default function NotFound() {
  return (
    <PublicLayout>
      <section className="not-found-page">
        <div className="container not-found-inner">
          <span className="not-found-code">404</span>
          <span className="eyebrow"><Icon name="circle-alert" size={14} /> Page not found</span>
          <h1>This page wandered off-script.</h1>
          <p>The URL you followed does not match a page in this workspace. Use the links below or return to the homepage.</p>
          <div className="hero-actions">
            <Link to="/" className="btn btn-primary btn-lg">Back to home <Icon name="arrow-right" size={16} /></Link>
            <Link to="/help" className="btn btn-secondary btn-lg">Visit help center</Link>
          </div>
          <div className="not-found-sitemap">
            {NAV_GROUPS.map((group) => (
              <nav key={group.id} aria-label={`${group.label} pages`}>
                <h2>{group.label}</h2>
                {group.links.map((page) => <Link key={page.path} to={page.path}>{page.label}</Link>)}
              </nav>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
