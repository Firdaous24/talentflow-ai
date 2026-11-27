import { useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  UsersRound,
  BriefcaseBusiness,
  Bot,
  Settings2,
  ArrowUpRight,
  Menu,
  X,
  ShieldCheck,
  ChevronRight,
  CircleHelp,
  Layers3,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { ThemeToggle } from "./components/ThemeToggle";
import { ToastProvider } from "./components/Toast";
import { WorkflowStepper } from "./components/WorkflowStepper";
import { SessionProvider } from "./session";
import { Parser } from "./pages/Parser";
import { JobAnalysis } from "./pages/JobAnalysis";
import { AIAgents } from "./pages/AIAgents";
import { AgentSessionProvider } from "./agentSession";
import { JobSessionProvider } from "./jobSession";
import { Candidates, CandidateDetail } from "./pages/Candidates";
import { Dashboard } from "./pages/Dashboard";
import { NotFound } from "./pages/NotFound";
import { Settings } from "./pages/Settings";
import { PublicApp, isPublicPath } from "./public/PublicApp";

const navigation: {
  path: string;
  label: string;
  icon: LucideIcon;
  planned?: boolean;
}[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/parser", label: "CV Parser", icon: FileText },
  { path: "/candidates", label: "Candidates", icon: UsersRound },
  {
    path: "/matching",
    label: "Job Analysis",
    icon: BriefcaseBusiness,
  },
  { path: "/agents", label: "AI Agents", icon: Bot },
  { path: "/settings", label: "Settings", icon: Settings2 },
];
function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title =
    navigation.find((item) => item.path === location.pathname)?.label ??
    "Candidate profile";
  return (
    <div className="workspace">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "open" : ""}`}
        aria-label="Main navigation"
      >
        <Link to="/" className="brand" onClick={() => setMobileOpen(false)}>
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>
          <span>
            TalentFlow<span className="brand-ai"> AI</span>
            <small>RECRUITMENT INTELLIGENCE</small>
          </span>
        </Link>
        <button
          className="icon-button mobile-close"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace-label">
          <span className="workspace-mark">T</span>
          <div>
            Talent workspace<small>Local session</small>
          </div>
          <span className="badge neutral">DEV</span>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navigation.map(({ path, label, icon: Icon, planned }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} />
              <span>{label}</span>
              {planned && <span className="soon-dot" title="Coming soon" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="session-note">
            <ShieldCheck size={21} />
            <strong>Your data stays temporary</strong>
            <p>
              Candidate profiles live in this session. Refresh to clear them.
            </p>
          </div>
          <Link to="/account" className="help-link" onClick={() => setMobileOpen(false)}>
            <UserRound size={17} aria-hidden="true" />
            My account
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <Link to="/settings" className="help-link">
            <CircleHelp size={17} />
            About this workspace
            <ArrowUpRight size={15} />
          </Link>
          <div className="sidebar-footer">
            <span className="avatar small">TF</span>
            <div>
              Portfolio workspace<small>TalentFlow AI · v0.8.0</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
        <div className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <ConnectionBadge />
            <ThemeToggle />
            <span className="topbar-divider" />
            <span className="avatar small">TF</span>
          </div>
        </div>
        <WorkflowStepper />
        </header>
        <main id="main" className="main-content">
          <div className="page-transition" key={location.pathname}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/parser" element={<Parser />} />
            <Route path="/candidates" element={<Candidates />} />
            <Route path="/candidates/:id" element={<CandidateDetail />} />
            <Route path="/matching" element={<JobAnalysis />} />
            <Route path="/agents" element={<AIAgents />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </div>
          <footer className="content-footer">
            <span>TalentFlow AI</span>
            <span>Built for thoughtful recruitment.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
export function App() {
  const { pathname } = useLocation();
  // Public and account pages have their own shell; the demo workbench keeps its
  // session providers mounted above both so navigating away loses nothing.
  return (
    <SessionProvider>
      <JobSessionProvider>
        <AgentSessionProvider>
          <ToastProvider>
            {isPublicPath(pathname) ? <PublicApp /> : <Layout />}
          </ToastProvider>
        </AgentSessionProvider>
      </JobSessionProvider>
    </SessionProvider>
  );
}
