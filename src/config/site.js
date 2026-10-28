export const SITE = {
  name: 'Faceless Studio',
  shortName: 'FS',
  tagline: 'Create once. Publish everywhere.',
  description: 'An AI-powered faceless video studio with real scheduling, official social publishing, analytics, and production safeguards.',
  email: 'hello@faceless.studio',
  securityEmail: 'security@faceless.studio',
};

// One source of truth for the public website. Header menus, mobile navigation,
// footer links, document titles, and route smoke tests are generated from this.
export const PUBLIC_PAGES = [
  { path: '/', label: 'Home', title: 'AI faceless video studio', description: 'Create and publish AI-assisted faceless videos from one workspace.', group: 'product', icon: 'home', menu: false },
  { path: '/filmmaking', label: 'AI Filmmaking', title: 'AI filmmaking studio', description: 'Create short dramas, films, and series with a scene-by-scene production workspace.', group: 'product', icon: 'clapperboard', eyebrow: 'Film studio' },
  { path: '/features', label: 'Features', title: 'Platform features', description: 'AI scripts, original visuals, narration, captions, rendering, publishing, and analytics.', group: 'product', icon: 'sparkles', eyebrow: 'Platform' },
  { path: '/solutions', label: 'Solutions', title: 'Solutions for creators and teams', description: 'Workflows for creators, agencies, educators, publishers, and businesses.', group: 'product', icon: 'layers', eyebrow: 'Who it is for' },
  { path: '/pricing', label: 'Pricing', title: 'Plans and pricing', description: 'Transparent usage-based plans with server-enforced limits.', group: 'product', icon: 'credit-card', eyebrow: 'Plans' },
  { path: '/integrations', label: 'Integrations', title: 'Official publishing integrations', description: 'Connect Facebook, Instagram, YouTube, X, AI, media, and payment providers.', group: 'product', icon: 'plug', eyebrow: 'Connect' },
  { path: '/docs', label: 'Documentation', title: 'Documentation', description: 'Set up the platform, understand the workflow, and configure production services.', group: 'resources', icon: 'book', eyebrow: 'Get started' },
  { path: '/help', label: 'Help Center', title: 'Help Center', description: 'Answers about accounts, content generation, publishing, billing, and security.', group: 'resources', icon: 'help', eyebrow: 'Support' },
  { path: '/status', label: 'Service Status', title: 'Service status', description: 'Live application and provider readiness information.', group: 'resources', icon: 'activity', eyebrow: 'Transparency' },
  { path: '/security', label: 'Security', title: 'Security', description: 'How credentials, sessions, webhooks, media, and account data are protected.', group: 'resources', icon: 'shield', eyebrow: 'Trust' },
  { path: '/changelog', label: 'Changelog', title: 'Product changelog', description: 'Recent platform improvements, integration work, and verification milestones.', group: 'resources', icon: 'clock', eyebrow: 'Updates' },
  { path: '/sitemap', label: 'Sitemap', title: 'Sitemap', description: 'Every public page and workspace destination in one organized index.', group: 'resources', icon: 'list-checks', eyebrow: 'Index' },
  { path: '/about', label: 'About', title: 'About Faceless Studio', description: 'The principles behind a responsible, creator-first automation platform.', group: 'company', icon: 'users', eyebrow: 'Company' },
  { path: '/contact', label: 'Contact', title: 'Contact us', description: 'Talk to the team about setup, integrations, partnerships, or security.', group: 'company', icon: 'mail', eyebrow: 'Contact' },
  { path: '/careers', label: 'Careers', title: 'Careers', description: 'Help build trustworthy creative automation tools.', group: 'company', icon: 'briefcase', eyebrow: 'Careers' },
  { path: '/press', label: 'Press', title: 'Press and brand', description: 'Product facts, positioning, and media contact details.', group: 'company', icon: 'megaphone', eyebrow: 'Media' },
  { path: '/privacy', label: 'Privacy Policy', title: 'Privacy Policy', description: 'What data the platform stores and how it is used.', group: 'legal', icon: 'lock', eyebrow: 'Legal' },
  { path: '/terms', label: 'Terms of Service', title: 'Terms of Service', description: 'The terms that govern use of the platform.', group: 'legal', icon: 'file-text', eyebrow: 'Legal' },
  { path: '/cookies', label: 'Cookie Policy', title: 'Cookie Policy', description: 'How essential session cookies and local preferences work.', group: 'legal', icon: 'cookie', eyebrow: 'Legal' },
  { path: '/acceptable-use', label: 'Acceptable Use', title: 'Acceptable Use Policy', description: 'Content, automation, copyright, and platform-rule requirements.', group: 'legal', icon: 'scale', eyebrow: 'Legal' },
  { path: '/dpa', label: 'Data Processing', title: 'Data Processing Addendum', description: 'A summary of controller, processor, and subprocessor responsibilities.', group: 'legal', icon: 'database', eyebrow: 'Legal' },
];

export const GROUP_LABELS = {
  product: 'Product',
  resources: 'Resources',
  company: 'Company',
  legal: 'Legal & trust',
};

export const NAV_GROUPS = Object.entries(GROUP_LABELS).map(([id, label]) => ({
  id,
  label,
  links: PUBLIC_PAGES.filter((page) => page.group === id && page.path !== '/'),
}));

export const FOOTER_GROUPS = NAV_GROUPS.map((group) => ({
  ...group,
  links: group.links.filter((page) => page.path !== '/'),
}));

export const PRIMARY_NAV = ['/features', '/filmmaking', '/solutions', '/pricing', '/docs'].map((path) => PUBLIC_PAGES.find((page) => page.path === path));

export const APP_PAGES = [
  { path: '/app', label: 'Dashboard', icon: 'layout-dashboard' },
  { path: '/app/studio', label: 'AI Studio', icon: 'wand-sparkles' },
  { path: '/app/projects', label: 'Projects', icon: 'folder' },
  { path: '/app/calendar', label: 'Calendar', icon: 'calendar' },
  { path: '/app/automation', label: 'Autopilot', icon: 'bot' },
  { path: '/app/publishing', label: 'Publishing', icon: 'send' },
  { path: '/app/accounts', label: 'Accounts', icon: 'users' },
  { path: '/app/analytics', label: 'Analytics', icon: 'bar-chart' },
  { path: '/app/billing', label: 'Plans & Billing', icon: 'credit-card' },
  { path: '/app/settings', label: 'Settings', icon: 'settings' },
  { path: '/app/admin', label: 'Admin', icon: 'shield', admin: true },
];

// Dedicated AI filmmaking navigation. These are real working destinations,
// not placeholders: each one reaches a functional tool or filtered workspace.
export const FILM_PAGES = [
  { path: '/app/films', label: 'Film Studio Hub', icon: 'clapperboard' },
  { path: '/app/films/short', label: 'Short Drama Studio', icon: 'smartphone' },
  { path: '/app/films/long', label: 'Long Drama & Movie', icon: 'film' },
  { path: '/app/films/series', label: 'Series & Episodes', icon: 'layers' },
  { path: '/app/films/scripts', label: 'AI Script Writer', icon: 'pen-line' },
  { path: '/app/films/characters', label: 'Character Studio', icon: 'users' },
  { path: '/app/films/scenes', label: 'Scene Generator', icon: 'wand-sparkles' },
  { path: '/app/films/audio', label: 'Voice & Audio', icon: 'mic2' },
  { path: '/app/films/editor', label: 'Movie Editor', icon: 'scissors' },
  { path: '/app/films/projects', label: 'My Projects', icon: 'folder' },
  { path: '/app/films/media', label: 'My Media', icon: 'image' },
  { path: '/app/films/published', label: 'Published Movies', icon: 'send' },
  { path: '/app/films/credits', label: 'Credits & Subscriptions', icon: 'credit-card' },
];

export const ALL_PUBLIC_LINKS = PUBLIC_PAGES.map((page) => ({ ...page, href: page.path }));

export function pageForPath(pathname) {
  return PUBLIC_PAGES.find((page) => page.path === pathname) || null;
}

export function documentTitleForPath(pathname) {
  const page = pageForPath(pathname);
  if (!page || page.path === '/') return `${SITE.name} — ${SITE.tagline}`;
  return `${page.title} | ${SITE.name}`;
}
