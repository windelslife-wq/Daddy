import React from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../config/site.js';
import { Icon } from '../../components/Icon.jsx';
import { CTASection, Callout, PageHero, Prose, Section } from '../../components/Marketing.jsx';

const UPDATED = 'October 27, 2026';

function LegalPage({ eyebrow, title, description, sections, children }) {
  return (
    <>
      <PageHero eyebrow={eyebrow} title={title} description={description} actions={<Link to="/contact" className="btn btn-secondary btn-lg">Ask a question <Icon name="mail" size={16} /></Link>} />
      <Section className="section-tight legal-section" eyebrow="Policy details" title="Read the full document">
        <Prose sections={sections} updated={UPDATED} />
        {children}
      </Section>
      <Section className="section-alt" eyebrow="Related documents" title="Policies and trust resources">
        <div className="legal-links">
          <Link to="/privacy"><Icon name="lock" size={17} /> Privacy Policy <Icon name="arrow-right" size={15} /></Link>
          <Link to="/terms"><Icon name="file-text" size={17} /> Terms of Service <Icon name="arrow-right" size={15} /></Link>
          <Link to="/cookies"><Icon name="cookie" size={17} /> Cookie Policy <Icon name="arrow-right" size={15} /></Link>
          <Link to="/acceptable-use"><Icon name="scale" size={17} /> Acceptable Use <Icon name="arrow-right" size={15} /></Link>
          <Link to="/dpa"><Icon name="database" size={17} /> Data Processing <Icon name="arrow-right" size={15} /></Link>
          <Link to="/security"><Icon name="shield-check" size={17} /> Security overview <Icon name="arrow-right" size={15} /></Link>
        </div>
      </Section>
      <CTASection title="Questions about these policies?" description="Contact us with the relevant section and your deployment context so the right person can respond." primary={{ to: '/contact', label: 'Contact us' }} secondary={{ to: '/help', label: 'Visit help center' }} />
    </>
  );
}

export function Privacy() {
  return (
    <LegalPage
      eyebrow="Privacy Policy"
      title="Privacy Policy"
      description={`This notice explains what ${SITE.name} stores to operate accounts, content workflows, publishing, billing, and support. The organization running a deployment is responsible for its own applicable policies.`}
      sections={[
        { title: 'Information we collect', paragraphs: ['We collect information necessary to provide the platform and keep it secure. This includes account details, workspace content, connected account metadata, usage records, billing state, and technical request data.'], bullets: ['Account data: name, email, password hash, role, plan, status, and login timestamps.', 'Content data: topics, scripts, scenes, generated media references, schedules, publications, and analytics snapshots.', 'Integration data: provider account identifiers, display names, granted scopes, encrypted tokens, and connection status.', 'Operational data: job logs, error messages, audit events, notifications, and limited request metadata.'] },
        { title: 'How information is used', paragraphs: ['Information is used to authenticate users, generate content, operate background jobs, publish approved content, measure results, enforce quotas, prevent duplicate publications, troubleshoot failures, and protect the service.', 'We do not sell personal information and we do not use your private workspace content for advertising.'], bullets: ['Provide and maintain the requested workflow.', 'Send operational notifications about jobs, publishing, billing, and security.', 'Comply with legal obligations and enforce platform policies.'] },
        { title: 'Provider connections', paragraphs: ['When you connect a social account, the platform receives tokens and public account metadata from that provider. Tokens are encrypted at rest and used only for the permissions you grant, such as publishing or reading metrics.', 'Disconnecting an account removes local credentials and attempts provider-side revocation where the provider supports it. Provider retention is governed by that provider’s own policies.'] },
        { title: 'Cookies and local storage', paragraphs: ['An HTTP-only session cookie keeps you signed in. Local browser storage stores your appearance preference. See the Cookie Policy for details.'] },
        { title: 'Retention and deletion', paragraphs: ['Operational records are retained while needed for the service, security, billing, and legal compliance. Generated files may be removed by cleanup jobs, while associated metadata can remain as an audit record until deleted by an administrator.', 'Contact the deployment operator to request access, correction, export, or deletion where applicable. Deletion may be limited by legal, security, or billing obligations.'] },
        { title: 'Security', paragraphs: ['We use server-side secrets, encrypted OAuth tokens, HTTP-only cookies, request validation, rate limits, signed webhooks, access controls, and audit logs. No system can promise absolute security; responsible deployment configuration remains essential.'] },
        { title: 'Contact', paragraphs: [`For privacy questions about this deployment, email ${SITE.email}. For security reports, use ${SITE.securityEmail}.`] },
      ]}
    />
  );
}

export function Terms() {
  return (
    <LegalPage
      eyebrow="Terms of Service"
      title="Terms of Service"
      description={`These terms summarize the conditions for using ${SITE.name}. The deployment operator may provide additional organization-specific terms.`}
      sections={[
        { title: 'Using the service', paragraphs: ['You must provide accurate account information, keep your credentials confidential, and use the service only where you have the rights and permissions necessary to create, publish, and measure content.', 'You are responsible for reviewing generated content before publication and for complying with third-party platform rules, copyright law, advertising standards, privacy law, and any industry-specific obligations.'], bullets: ['Do not share accounts or circumvent usage limits.', 'Do not interfere with background jobs, API rate limits, or other users.', 'Do not use the service to distribute unlawful, deceptive, harmful, or rights-infringing material.'] },
        { title: 'Generated content and rights', paragraphs: ['The platform provides tools to generate scripts, visuals, audio, captions, and videos. You must decide whether the resulting content is accurate, lawful, appropriately licensed, and suitable for publication.', 'Local procedural assets and generated ambient audio are created by the system, but this does not relieve you of obligations relating to third-party source material, trademarks, music, likenesses, or factual claims.'] },
        { title: 'Third-party integrations', paragraphs: ['Official provider integrations depend on credentials, app review, scopes, API tiers, account permissions, rate limits, and public HTTPS media access. We cannot guarantee that a provider will approve your app, grant a scope, accept a post, or supply analytics.', 'Sandbox publishing and simulated provider responses are for testing and are clearly identified as such. They are not live social-network publications.'] },
        { title: 'Plans, quotas, and billing', paragraphs: ['Usage limits are enforced server-side. Paid plans require valid payment details and a functioning Stripe configuration. Subscription changes are applied through signed webhooks or administrator actions.', 'A failed provider request does not guarantee a successful publication. Review the stored status and error details before taking further action.'] },
        { title: 'Availability and changes', paragraphs: ['The service may change, be interrupted for maintenance, or be limited by provider outages. Background jobs are designed with retries and duplicate prevention, but no automated publishing system can guarantee delivery in every circumstance.', 'We may update these terms as the platform evolves. The “Last updated” date above reflects the current version.'] },
        { title: 'Suspension', paragraphs: ['Accounts may be suspended for security, abuse, legal, provider-policy, or non-payment reasons. Where appropriate, operators should provide a reason and a path to resolve the issue.'] },
        { title: 'Contact', paragraphs: [`Questions about these terms can be sent to ${SITE.email}.`] },
      ]}
    />
  );
}

export function Cookies() {
  return (
    <LegalPage
      eyebrow="Cookie Policy"
      title="Cookie Policy"
      description="A focused explanation of the small amount of browser state used by the application."
      sections={[
        { title: 'Essential session cookie', paragraphs: ['The application uses one HTTP-only cookie to maintain an authenticated session. It contains an opaque session identifier, is not accessible to frontend JavaScript, and is sent only with requests to the application origin.', 'The cookie uses SameSite protections and is marked Secure when the deployment is configured for HTTPS.'], bullets: ['Purpose: authentication and account security.', 'Duration: until logout, expiration, or session revocation.', 'Controls: signing out clears the cookie; password changes invalidate active sessions.'] },
        { title: 'Local appearance preference', paragraphs: ['Your selected appearance theme is stored in browser local storage under faceless-studio-theme. This is not a tracking cookie and is not sent to the server with ordinary requests.', 'If you choose System, the browser’s prefers-color-scheme media query determines whether Daylight or Midnight is applied.'] },
        { title: 'Analytics and advertising', paragraphs: ['The application does not include third-party advertising or cross-site tracking cookies by default. Analytics in the product refer to metrics imported from connected publishing platforms, not advertising profiles.'] },
        { title: 'Provider cookies', paragraphs: ['When you start an OAuth connection, the provider’s own website may use cookies according to its privacy policy. Those cookies are controlled by the provider, not this application.'] },
        { title: 'Managing your choices', paragraphs: ['You can clear local storage in your browser to reset the theme preference. Blocking the essential session cookie will prevent you from staying signed in.', `Contact ${SITE.email} with questions about browser state in a specific deployment.`] },
      ]}
    />
  );
}

export function AcceptableUse() {
  return (
    <LegalPage
      eyebrow="Acceptable Use"
      title="Acceptable Use Policy"
      description="Content automation must respect people, rights, platforms, and the law."
      sections={[
        { title: 'Respect rights and permissions', paragraphs: ['Use only material you own, license, or are otherwise legally permitted to use. This includes scripts, images, video, music, voices, trademarks, logos, quotations, personal data, and recognizable likenesses.'], bullets: ['Do not upload or generate infringing content.', 'Do not clone a real person’s voice or identity without permission.', 'Do not misrepresent AI-generated media as authentic footage where disclosure is required.'] },
        { title: 'Accuracy and harmful content', paragraphs: ['AI-generated scripts can contain errors. Verify factual claims, especially for news, health, finance, legal, historical, and true-crime topics before publication.', 'Do not use the service for fraud, impersonation, harassment, hate, exploitation, dangerous instructions, spam, deceptive engagement, or illegal activity.'] },
        { title: 'Platform compliance', paragraphs: ['Each connected platform has its own community standards, automation rules, API terms, rate limits, metadata requirements, and app-review processes. You are responsible for following them.', 'Do not use the platform to evade enforcement, create duplicate accounts, manipulate engagement, or publish content that the target platform prohibits.'] },
        { title: 'Automation controls', paragraphs: ['Use review gates and daily posting limits appropriate to your account and content category. Inspect failures rather than repeatedly retrying an unsuitable post.', 'The platform’s duplicate-prevention mechanisms reduce accidental repeats but do not authorize excessive automation.'] },
        { title: 'Security and abuse', paragraphs: ['Do not probe, overload, scrape, reverse engineer, or attempt to access data that does not belong to you. Protect API keys, OAuth tokens, and account credentials.', 'Report suspected vulnerabilities responsibly to the security contact.'] },
        { title: 'Enforcement', paragraphs: ['Operators may remove content, disconnect accounts, suspend users, or restrict features to address legal, security, provider-policy, or abuse concerns.'] },
      ]}
    >
      <Callout icon="scale" title="Review is not optional for sensitive content" tone="warning">
        Keep review-required enabled and involve a qualified human editor for claims, rights, regulated topics, or content involving real people.
      </Callout>
    </LegalPage>
  );
}

export function Dpa() {
  return (
    <LegalPage
      eyebrow="Data Processing"
      title="Data Processing Addendum"
      description="A practical summary of roles and responsibilities when a deployment processes personal data on behalf of an organization."
      sections={[
        { title: 'Roles', paragraphs: ['The organization operating the deployment is generally the data controller for its workspace users and content subjects. Infrastructure and service providers may act as processors or subprocessors depending on the deployment.', 'This summary is not legal advice. Organizations should execute a formal agreement appropriate to their jurisdiction and data types.'] },
        { title: 'Categories of data', paragraphs: ['The platform may process account identifiers, contact details, authentication metadata, OAuth account identifiers and encrypted tokens, user-generated content, publication metadata, technical request data, billing references, notification addresses, and support messages.', 'It is not designed to intentionally collect special-category personal data. Customers should avoid submitting sensitive categories unless their policies, agreements, and security controls permit it.'] },
        { title: 'Processing instructions', paragraphs: ['Data is processed to provide the features requested by the operator and user: generation, scheduling, review, publishing, measurement, billing, support, security, and audit logging.', 'Background workers process queued jobs, external provider APIs receive only the data required for the selected integration, and notification services may receive event payloads configured by the operator.'] },
        { title: 'Subprocessors', paragraphs: ['Depending on configuration, subprocessors may include hosting, PostgreSQL, AI, image, voice, research, email, payment, and social publishing providers. The operator is responsible for maintaining its own subprocessor list and assessing each provider’s terms.'], bullets: ['Social platforms: receive OAuth data, media, metadata, and metric requests.', 'Stripe: receives checkout and subscription-related data when billing is enabled.', 'SMTP provider: receives notification email addresses and content when configured.', 'Webhook endpoint: receives HMAC-signed event payloads when configured.'] },
        { title: 'Security measures', paragraphs: ['Measures include encryption of provider tokens at rest, HTTP-only session cookies, server-side secrets, request validation, access controls, signed webhooks, production HTTPS requirements, audit events, and background job error logging.'] },
        { title: 'International transfers', paragraphs: ['External providers may process data in other jurisdictions. The operator should evaluate transfer mechanisms, data residency requirements, and provider-specific terms before enabling those integrations.'] },
        { title: 'Deletion and return', paragraphs: ['Administrators can export or delete workspace records according to their operational processes. Generated files may be removed by cleanup jobs. Provider-side data is governed by the relevant provider’s retention policies.', `Contact ${SITE.email} for deployment-specific questions about data lifecycle controls.`] },
      ]}
    />
  );
}
