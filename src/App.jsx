import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
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
import SandboxConsent from './pages/SandboxConsent.jsx';
import SandboxPost from './pages/SandboxPost.jsx';
import NotFound from './pages/NotFound.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [pathname]);
  return null;
}

function ProtectedLayout() {
  const { loading, authenticated } = useAuth();
  const location = useLocation();
  if (loading) return <div className="full-loader"><Loader2 className="spin" size={28} /><span>Loading your workspace…</span></div>;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

export default function App() {
  const { authenticated, loading } = useAuth();
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={!loading && authenticated ? <Navigate to="/app" replace /> : <Login />} />
        <Route path="/oauth/sandbox" element={<SandboxConsent />} />
        <Route path="/sandbox/posts/:id" element={<SandboxPost />} />
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
        </Route>
        <Route path="/" element={<Navigate to={authenticated ? '/app' : '/login'} replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
