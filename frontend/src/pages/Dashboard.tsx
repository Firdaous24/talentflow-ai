import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  FileText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { useSession } from "../session";

export function Dashboard() {
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
          <p>Explore document evidence and explicit human review.</p>
          <Link to="/matching" className="roadmap-item">
            <span className="icon-box neutral">
              <BriefcaseBusiness size={18} />
            </span>
            <div>
              <strong>Job Analysis</strong>
              <small>Review requirements and compare documented evidence</small>
            </div>
            <span className="badge green">Available</span>
          </Link>
          <Link to="/agents" className="roadmap-item">
            <span className="icon-box neutral">
              <Bot size={18} />
            </span>
            <div>
              <strong>Evidence workflow</strong>
              <small>LangGraph orchestration with a human checkpoint</small>
            </div>
            <span className="badge green">Available</span>
          </Link>
          <p className="roadmap-note">Deterministic nodes coordinate evidence services; no external model is called.</p>
        </section>
      </div>
    </>
  );
}
function UploadIcon() {
  return <FileText size={17} />;
}
