import React from 'react';
import { Link } from 'react-router-dom';
import { APP_PAGES, NAV_GROUPS, PUBLIC_PAGES } from '../../config/site.js';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, PageHero, Section } from '../../components/Marketing.jsx';

export default function Sitemap() {
  return (
    <>
      <PageHero
        eyebrow="Sitemap"
        title="Every page, organized in one place"
        description="Use this index to find product information, documentation, company pages, policies, and workspace destinations."
        actions={<Link to="/" className="btn btn-secondary btn-lg"><Icon name="home" size={16} /> Back to home</Link>}
      />
      <Section className="section-tight" eyebrow="Public website" title="Website pages" description="All public routes are available in the header Explore menu and generated footer.">
        <div className="sitemap-grid">
          {NAV_GROUPS.map((group) => (
            <section key={group.id} className="sitemap-card">
              <h2><Icon name={group.id === 'product' ? 'layers' : group.id === 'resources' ? 'book' : group.id === 'company' ? 'users' : 'shield'} size={18} /> {group.label}</h2>
              <ul>
                {group.links.map((page) => <li key={page.path}><Link to={page.path}><Icon name={page.icon} size={15} /><span>{page.label}</span><Icon name="arrow-up-right" size={13} /></Link></li>)}
              </ul>
            </section>
          ))}
          <section className="sitemap-card">
            <h2><Icon name="home" size={18} /> Start</h2>
            <ul><li><Link to="/"><Icon name="home" size={15} /><span>Home</span><Icon name="arrow-up-right" size={13} /></Link></li><li><Link to="/login"><Icon name="login" size={15} /><span>Sign in</span><Icon name="arrow-up-right" size={13} /></Link></li><li><Link to="/signup"><Icon name="user-plus" size={15} /><span>Create account</span><Icon name="arrow-up-right" size={13} /></Link></li></ul>
          </section>
        </div>
      </Section>
      <Section className="section-alt" eyebrow="Workspace" title="Application pages" description="These routes require an authenticated session and use the application layout.">
        <div className="sitemap-app-grid">
          {APP_PAGES.map((page) => <Link key={page.path} to={page.path}><Icon name={page.icon} size={16} /><span>{page.label}</span><code>{page.path}</code></Link>)}
        </div>
      </Section>
      <Section eyebrow="Coverage" title={`${PUBLIC_PAGES.length} public pages across every theme`} description="The active appearance theme is stored once and applied to public pages, authentication pages, application pages, and the footer." align="center">
        <div className="three-up-grid">
          <div className="number-panel"><span>01</span><h3>One shared site map</h3><p>Header menus, mobile navigation, the footer, and this sitemap use the same route definitions.</p></div>
          <div className="number-panel"><span>02</span><h3>Four appearance modes</h3><p>System, Midnight, Daylight, and Aurora are available from every page layout.</p></div>
          <div className="number-panel"><span>03</span><h3>Consistent experience</h3><p>Marketing, legal, documentation, authentication, and workspace pages share the same design tokens.</p></div>
        </div>
      </Section>
      <CTASection title="Ready to start?" description="Create an account to explore the full application workflow or read the setup guide first." primary={{ to: '/signup', label: 'Create account' }} secondary={{ to: '/docs', label: 'Read docs' }} />
    </>
  );
}
