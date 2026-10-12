import { useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  UsersRound,
  BriefcaseBusiness,
  Bot,
  Settings2,
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  Menu,
  X,
  ShieldCheck,
  Activity,
  RefreshCw,
  ChevronRight,
  Clock3,
  CircleHelp,
  Layers3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SessionProvider, useSession } from "./session";
import { API_BASE_URL } from "./api";
import { Parser } from "./pages/Parser";
import { ReviewProfile } from "./components/ReviewProfile";

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
    label: "Job Matching",
    icon: BriefcaseBusiness,
    planned: true,
  },
  { path: "/agents", label: "AI Agents", icon: Bot, planned: true },
  { path: "/settings", label: "Settings", icon: Settings2 },
];
function ConnectionBadge() {
  const { connection } = useSession();
  return (
    <span className={`connection ${connection}`} role="status">
      <i />
      {connection === "online"
        ? "Backend connected"
        : connection === "offline"
          ? "Backend unavailable"
          : "Checking backend"}
    </span>
  );
}
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
          <Link to="/settings" className="help-link">
            <CircleHelp size={17} />
            About this workspace
            <ArrowUpRight size={15} />
          </Link>
          <div className="sidebar-footer">
            <span className="avatar small">TF</span>
            <div>
              Portfolio workspace<small>TalentFlow AI · v0.1.0</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
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
            <span className="topbar-divider" />
            <span className="avatar small">TF</span>
          </div>
        </header>
        <main id="main" className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/parser" element={<Parser />} />
            <Route path="/candidates" element={<Candidates />} />
            <Route path="/candidates/:id" element={<CandidateDetail />} />
            <Route path="/matching" element={<ComingSoon kind="matching" />} />
            <Route path="/agents" element={<ComingSoon kind="agents" />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <footer className="content-footer">
            <span>TalentFlow AI</span>
            <span>Built for thoughtful recruitment.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Dashboard() {
  const { candidates, connection, checkHealth } = useSession();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR RECRUITMENT WORKSPACE</span>
          <h1>A clearer view of talent.</h1>
          <p>
            Welcome to TalentFlow AI. Start with a CV, discover the details.
          </p>
        </div>
        <Link to="/parser" className="button primary">
          <UploadIcon />
          Parse a CV
        </Link>
      </div>
      <section className="welcome-banner">
        <div className="banner-copy">
          <span className="banner-kicker">
            <Sparkles size={15} />
            LESS ADMIN. MORE INSIGHT.
          </span>
          <h2>
            The next great hire
            <br />
            starts with understanding.
          </h2>
          <p>
            Transform a candidate’s PDF into an organized profile.
            <br className="desktop-break" /> Get the context you need, with
            extraction limits made clear.
          </p>
          <Link to="/parser" className="button white">
            Upload your first CV
            <ArrowRight size={17} />
          </Link>
          <span className="banner-footnote">
            Text-based PDFs · No third-party uploads
          </span>
        </div>
        <div className="document-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-document">
            <div className="art-header">
              <div className="art-avatar">
                <UsersRound size={25} />
              </div>
              <div>
                <i />
                <i />
              </div>
              <span>
                <Sparkles size={18} />
              </span>
            </div>
            <div className="art-rule" />
            <div className="art-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="art-tags">
              <span>Profile</span>
              <span>Skills</span>
              <span>Experience</span>
            </div>
            <div className="art-lines short">
              <i />
              <i />
            </div>
          </div>
          <div className="art-chip">
            <ShieldCheck size={19} />
            <span>Structured. Transparent.</span>
          </div>
          <div className="art-spark">
            <Sparkles size={24} />
          </div>
        </div>
      </section>
      <div className="overview-grid">
        <section className="card overview-card">
          <div className="icon-box">
            <FileText size={20} />
          </div>
          <span className="badge green">Available</span>
          <h3>CV intelligence</h3>
          <p>Extract supported candidate fields from PDF documents.</p>
          <Link to="/parser">
            Open CV Parser
            <ArrowRight size={15} />
          </Link>
        </section>
        <section className="card overview-card">
          <div className="icon-box blue">
            <UsersRound size={20} />
          </div>
          <span className="badge neutral">In session</span>
          <h3>
            {candidates.length}{" "}
            {candidates.length === 1 ? "candidate" : "candidates"} parsed
          </h3>
          <p>Successfully parsed profiles in this session only.</p>
          <Link to="/candidates">
            View candidates
            <ArrowRight size={15} />
          </Link>
        </section>
        <section className="card overview-card">
          <div className={`icon-box ${connection === "online" ? "mint" : ""}`}>
            <Activity size={20} />
          </div>
          <h3>API connection</h3>
          <ConnectionBadge />
          <p>Application liveness checked every minute.</p>
          <button
            className="text-button"
            onClick={() => void checkHealth()}
            disabled={connection === "checking"}
          >
            Check connection
            <RefreshCw
              size={14}
              className={connection === "checking" ? "spin" : ""}
            />
          </button>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="card activity-card">
          <div className="section-title">
            <div>
              <h2>Recent activity</h2>
              <p>Your parsing activity, for this session.</p>
            </div>
            <span className="badge neutral">SESSION ONLY</span>
          </div>
          {candidates.length ? (
            <div className="activity-list">
              {candidates.slice(0, 4).map((entry) => (
                <Link
                  className="activity-item"
                  key={entry.id}
                  to={`/candidates/${entry.id}`}
                >
                  <span className="icon-box">
                    <FileText size={18} />
                  </span>
                  <div>
                    <strong>
                      {(entry.reviewedCandidate ?? entry.candidate).full_name ??
                        "Name not extracted"}
                    </strong>
                    <p>{entry.filename}</p>
                  </div>
                  <span className="activity-time">
                    {new Date(entry.parsedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <Clock3 size={26} />
              </span>
              <h3>Your workspace is ready</h3>
              <p>Parse your first CV to see activity here.</p>
              <Link to="/parser" className="text-button">
                Get started
                <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </section>
        <section className="card roadmap-card">
          <span className="eyebrow">WHAT’S NEXT</span>
          <h2>
            A smarter workflow,
            <br />
            one step at a time.
          </h2>
          <p>Here’s what’s planned for TalentFlow AI.</p>
          <Link to="/matching" className="roadmap-item">
            <span className="icon-box neutral">
              <BriefcaseBusiness size={18} />
            </span>
            <div>
              <strong>Explainable job matching</strong>
              <small>Compare profiles with job requirements</small>
            </div>
            <span className="badge neutral">Soon</span>
          </Link>
          <Link to="/agents" className="roadmap-item">
            <span className="icon-box neutral">
              <Bot size={18} />
            </span>
            <div>
              <strong>Multi-agent analysis</strong>
              <small>A future LangGraph workflow</small>
            </div>
            <span className="badge neutral">Soon</span>
          </Link>
          <p className="roadmap-note">Planned modules are not active yet.</p>
        </section>
      </div>
    </>
  );
}
function UploadIcon() {
  return <FileText size={17} />;
}
function Candidates() {
  const { candidates, clearCandidates } = useSession();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SESSION</span>
          <h1>Candidates</h1>
          <p>Review the profiles you’ve parsed in this workspace.</p>
        </div>
        <Link to="/parser" className="button primary">
          <FileText size={17} />
          Parse a CV
        </Link>
      </div>
      <div className="notice info">
        <ShieldCheck size={19} />
        <div>
          <strong>Temporary by design</strong>
          <p>
            These profiles exist only in browser memory. Refreshing or closing
            this page clears the list.
          </p>
        </div>
      </div>
      <section className="card candidates-card">
        <div className="section-title">
          <h2>
            Parsed candidates <span className="count">{candidates.length}</span>
          </h2>
          {candidates.length > 0 && (
            <button className="text-button" onClick={clearCandidates}>
              Clear session profiles
              <X size={15} />
            </button>
          )}
        </div>
        {candidates.length ? (
          <div className="candidate-list">
            {candidates.map((entry) => (
              <Link
                className="candidate-row"
                key={entry.id}
                to={`/candidates/${entry.id}`}
              >
                <span className="avatar">
                  {(entry.reviewedCandidate ?? entry.candidate).full_name
                    ?.slice(0, 2)
                    .toUpperCase() ?? "?"}
                </span>
                <div className="candidate-row-main">
                  <h3>
                    {(entry.reviewedCandidate ?? entry.candidate).full_name ??
                      "Name not extracted"}
                  </h3>
                  <p>
                    {(entry.reviewedCandidate ?? entry.candidate).email ??
                      "Email not extracted"}{" "}
                    · {entry.filename}
                  </p>
                </div>
                <span className="badge amber">Partial extraction</span>
                <span
                  className={`badge ${entry.confirmed ? "green" : "neutral"}`}
                >
                  {entry.confirmed ? "Confirmed" : "Review required"}
                </span>
                <time dateTime={entry.parsedAt}>
                  {new Date(entry.parsedAt).toLocaleString()}
                </time>
                <ChevronRight size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <UsersRound size={28} />
            </span>
            <h3>No candidates in this session</h3>
            <p>Upload a PDF to create your first candidate profile.</p>
            <Link to="/parser" className="button secondary">
              Parse a CV
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
function CandidateDetail() {
  const { id } = useParams();
  const { candidates } = useSession();
  const entry = candidates.find((candidate) => candidate.id === id);
  return entry ? (
    <>
      <Link to="/candidates" className="back-link">
        ← Back to candidates
      </Link>
      <div className="page-heading">
        <div>
          <h1>Candidate profile</h1>
          <p>
            {entry.filename} · Parsed{" "}
            {new Date(entry.parsedAt).toLocaleString()}
          </p>
        </div>
      </div>
      <ReviewProfile entry={entry} />
    </>
  ) : (
    <>
      <h1>Profile unavailable</h1>
      <p>This profile is no longer in the current session.</p>
      <Link to="/parser" className="button primary">
        Parse a CV
      </Link>
    </>
  );
}
function ComingSoon({ kind }: { kind: "matching" | "agents" }) {
  const matching = kind === "matching";
  const Icon = matching ? BriefcaseBusiness : Bot;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE ROAD AHEAD</span>
          <h1>{matching ? "Job Matching" : "AI Agents"}</h1>
          <p>
            {matching
              ? "More context for better recruitment decisions."
              : "A coordinated approach to recruitment analysis."}
          </p>
        </div>
        <span className="badge violet">Coming soon</span>
      </div>
      <section className="card coming-soon">
        <span className="coming-icon">
          <Icon size={40} strokeWidth={1.5} />
        </span>
        <span className="eyebrow">PLANNED MODULE</span>
        <h2>
          {matching
            ? "Understand the fit. See the reasoning."
            : "Specialized agents. A shared workflow."}
        </h2>
        <p>
          {matching
            ? "Future job analysis will compare candidate profiles with role requirements and explain the evidence behind each recommendation. Matching and scores are not available yet."
            : "A future LangGraph workflow will coordinate specialized agents for CV analysis, job understanding and explainable recommendations. No AI agents are running in this version."}
        </p>
        <div className="planned-features">
          {(matching
            ? [
                "Job requirement analysis",
                "Evidence-based comparison",
                "Explainable recommendations",
              ]
            : [
                "LangGraph orchestration",
                "Specialized analysis steps",
                "Transparent review outputs",
              ]
          ).map((item) => (
            <span key={item}>
              <Clock3 size={15} />
              {item}
            </span>
          ))}
        </div>
        <Link to="/parser" className="button primary">
          Explore the CV Parser
          <ArrowRight size={17} />
        </Link>
      </section>
    </>
  );
}
function Settings() {
  const { connection, healthError, checkHealth } = useSession();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">APPLICATION INFORMATION</span>
          <h1>Settings</h1>
          <p>
            Connection details and the current capabilities of your workspace.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h2>
            <Activity size={20} />
            Backend connection
          </h2>
          <ConnectionBadge />
          <p>
            The health endpoint checks API liveness. It does not test database
            readiness.
          </p>
          {healthError && (
            <div className="notice error" role="alert">
              {healthError}
            </div>
          )}
          <dl className="info-list">
            <div>
              <dt>API base URL</dt>
              <dd>{API_BASE_URL || "Same origin (local /api proxy)"}</dd>
            </div>
            <div>
              <dt>Health endpoint</dt>
              <dd>GET /api/v1/health</dd>
            </div>
            <div>
              <dt>CV parsing</dt>
              <dd>POST /api/v1/candidates/parse</dd>
            </div>
          </dl>
          <button
            className="button secondary"
            disabled={connection === "checking"}
            onClick={() => void checkHealth()}
          >
            <RefreshCw
              size={16}
              className={connection === "checking" ? "spin" : ""}
            />
            Check connection
          </button>
        </section>
        <section className="card">
          <h2>
            <Layers3 size={20} />
            About TalentFlow AI
          </h2>
          <p>
            A recruitment intelligence portfolio project with a working PDF
            extraction workflow.
          </p>
          <dl className="info-list">
            <div>
              <dt>Version</dt>
              <dd>0.1.0</dd>
            </div>
            <div>
              <dt>Extraction engine</dt>
              <dd>deterministic-v2 · optional consent-gated model</dd>
            </div>
            <div>
              <dt>Accepted documents</dt>
              <dd>Text-based PDF · 5 MiB · 10 pages</dd>
            </div>
            <div>
              <dt>Profile storage</dt>
              <dd>Current session only</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>Not implemented</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="notice info">
        <ShieldCheck size={20} />
        <div>
          <strong>Privacy and current limits</strong>
          <p>
            PDF files go to the TalentFlow backend; extraction stays local by
            default. Optional model assistance sends extracted text to the
            displayed provider only with per-upload consent. Profiles remain in
            memory, without browser storage or database persistence. OCR, job
            matching and agents are planned.
          </p>
        </div>
      </div>
    </>
  );
}
function NotFound() {
  return (
    <section className="card empty-state">
      <h1>Page not found</h1>
      <p>This route is not part of the workspace.</p>
      <Link to="/" className="button primary">
        Back to dashboard
      </Link>
    </section>
  );
}
export function App() {
  return (
    <SessionProvider>
      <Layout />
    </SessionProvider>
  );
}
