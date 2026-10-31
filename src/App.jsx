import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { documentTitleForPath, pageForPath, SITE } from './config/site.js';
import PublicLayout from './components/PublicLayout.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Home from './pages/public/Home.jsx';
import Features from './pages/public/Features.jsx';
import Filmmaking from './pages/public/Filmmaking.jsx';
import Solutions from './pages/public/Solutions.jsx';
import Pricing from './pages/public/Pricing.jsx';
import About from './pages/public/About.jsx';
import Contact from './pages/public/Contact.jsx';
import { Docs, Integrations, Help, Status, Security, Changelog, Careers, Press } from './pages/public/Resources.jsx';
import Sitemap from './pages/public/Sitemap.jsx';
import { Privacy, Terms, Cookies, AcceptableUse, Dpa } from './pages/public/Legal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Studio from './pages/Studio.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Accounts from './pages/Accounts.jsx';
import Calendar from './pages/Calendar.jsx';
import Publishing from './pages/Publishing.jsx';
import Analytics from './pages/Analytics.jsx';
import Automation from './pages/Automation.jsx';
import Settings from './pages/Settings.jsx';
import Billing from './pages/Billing.jsx';
import Admin from './pages/Admin.jsx';
import FilmStudio from './pages/film/FilmStudio.jsx';
import ProductionAgent from './pages/film/ProductionAgent.jsx';
import FilmWorkspace from './pages/film/FilmWorkspace.jsx';
import SandboxConsent from './pages/SandboxConsent.jsx';
import SandboxPost from './pages/SandboxPost.jsx';
import NotFound from './pages/NotFound.jsx';

const SPECIAL_TITLES = {
  '/login': 'Sign in',
  '/signup': 'Create account',
  '/oauth/sandbox': 'Connect sandbox channel',
};

function PageMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    let title = SPECIAL_TITLES[pathname];
    if (!title && pathname.startsWith('/sandbox/posts/')) title = 'Sandbox publication';
    if (!title && pathname.startsWith('/app')) title = 'Workspace';
    document.title = title ? `${title} | ${SITE.name}` : documentTitleForPath(pathname);
    const page = pageForPath(pathname);
    const description = page?.description || SITE.description;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', description);
  }, [pathname]);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [pathname]);
  return null;
}

function ProtectedLayout() {
  const { loading, authenticated } = useAuth();
  const location = useLocation();
  if (loading) return <div className="full-loader"><Loader2 className="spin" size={28} /><span>Loading your workspace…</span></div>;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  return <Layout />;
}

export default function App() {
  return (
    <>
      <PageMetadata />
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/oauth/sandbox" element={<PublicLayout><SandboxConsent /></PublicLayout>} />
        <Route path="/sandbox/posts/:id" element={<PublicLayout><SandboxPost /></PublicLayout>} />
        <Route path="/app" element={<ProtectedLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="studio" element={<Studio />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="publishing" element={<Publishing />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="automation" element={<Automation />} />
          <Route path="settings" element={<Settings />} />
          <Route path="billing" element={<Billing />} />
          <Route path="admin" element={<Admin />} />
          <Route path="films" element={<FilmStudio view="hub" />} />
          <Route path="films/short" element={<FilmStudio view="short" />} />
          <Route path="films/long" element={<FilmStudio view="long" />} />
          <Route path="films/series" element={<FilmStudio view="series" />} />
          <Route path="films/agent" element={<ProductionAgent />} />
          <Route path="films/scripts" element={<FilmStudio view="scripts" />} />
          <Route path="films/characters" element={<FilmStudio view="characters" />} />
          <Route path="films/scenes" element={<FilmStudio view="scenes" />} />
          <Route path="films/audio" element={<FilmStudio view="audio" />} />
          <Route path="films/editor" element={<FilmStudio view="editor" />} />
          <Route path="films/projects" element={<FilmStudio view="projects" />} />
          <Route path="films/media" element={<FilmStudio view="media" />} />
          <Route path="films/published" element={<FilmStudio view="published" />} />
          <Route path="films/credits" element={<FilmStudio view="credits" />} />
          <Route path="films/project/:id" element={<FilmWorkspace />} />
        </Route>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/filmmaking" element={<Filmmaking />} />
          <Route path="/features" element={<Features />} />
          <Route path="/solutions" element={<Solutions />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/help" element={<Help />} />
          <Route path="/status" element={<Status />} />
          <Route path="/security" element={<Security />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/sitemap" element={<Sitemap />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/press" element={<Press />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="/acceptable-use" element={<AcceptableUse />} />
          <Route path="/dpa" element={<Dpa />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
