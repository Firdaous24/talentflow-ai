import { useCallback, useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Briefcase, Trash2 } from "lucide-react";
import { Badge, Skeleton, StatusPill } from "../../components/ui";
import { Notice, useDocumentTitle } from "../shared";
import { Criteria } from "../candidate/Offers";
import { formatDate } from "../candidate/shared";
import type { Failure } from "../candidate/shared";
import { recruiterApi } from "./api";
import type { JobStatus, OrgJobDetail, OrgJobSummary, Visibility } from "./api";
import { ImportCard, ReviewQueue } from "./Import";
import { RankingView, useRecruiterError } from "./Ranking";
import "./recruiter.css";

export function JobsPage({ org }: { org: string | null }) {
  const { t, i18n } = useTranslation();
  const toFailure = useRecruiterError();
  const navigate = useNavigate();
  const textId = useId();
  useDocumentTitle(t("recruiter.jobs.title"));
  const [jobs, setJobs] = useState<OrgJobSummary[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  useEffect(() => {
    if (!org) return;
    recruiterApi(org).jobs().then(setJobs).catch((error) => setFailure(toFailure(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  if (!org) return <Notice tone="info">{t("recruiter.noOrg")}</Notice>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!org || busy || text.trim().length < 30) return;
    setBusy(true);
    setFailure(null);
    try {
      const job = await recruiterApi(org).createJob(text);
      navigate(`/account/jobs/${job.id}`);
    } catch (error) {
      setFailure(toFailure(error));
      setBusy(false);
    }
  }

  return (
    <div className="candidate-page">
      <div className="page-heading">
        <div>
          <h2 className="candidate-title">{t("recruiter.jobs.title")}</h2>
          <p>{t("recruiter.jobs.lead")}</p>
        </div>
      </div>
      <div className="account-grid">
        <section className="card account-card" aria-labelledby="job-create-heading">
          <h2 id="job-create-heading"><Briefcase size={19} aria-hidden="true" />{t("recruiter.jobs.create")}</h2>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <div className="auth-field">
              <label htmlFor={textId}>{t("recruiter.jobs.paste")}</label>
              <textarea id={textId} rows={9} maxLength={30000} value={text} onChange={(event) => setText(event.target.value)} />
            </div>
            {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
            <button type="submit" className="button primary" disabled={busy || text.trim().length < 30}>{busy ? t("recruiter.jobs.analyzing") : t("recruiter.jobs.analyze")}</button>
          </form>
        </section>
        <section className="card account-card" aria-labelledby="job-list-heading">
          <h2 id="job-list-heading">{t("recruiter.jobs.listTitle")}</h2>
          {jobs === null ? (
            <Skeleton width="70%" />
          ) : jobs.length === 0 ? (
            <p>{t("recruiter.jobs.empty")}</p>
          ) : (
            <ul className="offer-list" aria-label={t("recruiter.jobs.listTitle")}>
              {jobs.map((job) => (
                <li key={job.id}>
                  <Link to={`/account/jobs/${job.id}`}>{job.title || t("recruiter.jobs.untitled")}</Link>
                  <span className="version-main">
                    <StatusPill status={job.status === "open" ? "documented" : "neutral"}>{t(`recruiter.jobs.status.${job.status}`)}</StatusPill>
                    <Badge tone={job.visibility === "public" ? "violet" : "neutral"}>{t(`recruiter.jobs.visibility.${job.visibility}`)}</Badge>
                  </span>
                  <span className="subtle">{formatDate(job.created_at, i18n.language)} · {t("recruiter.jobs.stats", { ranked: job.ranked, pending: job.pending, toReview: job.to_review })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusCard({ org, job, onChange }: { org: string; job: OrgJobDetail; onChange: (job: OrgJobDetail) => void }) {
  const { t } = useTranslation();
  const toFailure = useRecruiterError();
  const [failure, setFailure] = useState<Failure>(null);
  const update = async (patch: { status?: JobStatus; visibility?: Visibility }) => {
    setFailure(null);
    try {
      onChange(await recruiterApi(org).updateJob(job.id, patch));
    } catch (error) {
      setFailure(toFailure(error));
    }
  };
  return (
    <section className="card account-card" aria-labelledby="job-status-heading">
      <h2 id="job-status-heading">{t("recruiter.job.statusTitle")}</h2>
      <p className="version-main">
        <StatusPill status={job.status === "open" ? "documented" : "neutral"}>{t(`recruiter.jobs.status.${job.status}`)}</StatusPill>
        <Badge tone={job.visibility === "public" ? "violet" : "neutral"}>{t(`recruiter.jobs.visibility.${job.visibility}`)}</Badge>
      </p>
      <p className="subtle">{t("recruiter.job.statusLead")}</p>
      <div className="criteria-actions">
        {job.status !== "open" && <button type="button" className="button secondary" disabled={!job.criteria_confirmed_at} onClick={() => void update({ status: "open" })}>{t("recruiter.job.open")}</button>}
        {job.status === "open" && job.visibility === "private" && <button type="button" className="button secondary" onClick={() => void update({ visibility: "public" })}>{t("recruiter.job.publish")}</button>}
        {job.visibility === "public" && <button type="button" className="button ghost" onClick={() => void update({ visibility: "private" })}>{t("recruiter.job.unpublish")}</button>}
        {job.status === "open" && <button type="button" className="button ghost" onClick={() => void update({ status: "closed", visibility: "private" })}>{t("recruiter.job.close")}</button>}
      </div>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </section>
  );
}

type OrgJob = OrgJobDetail & { organization_id: string };

export function JobPage({ org }: { org: string | null }) {
  const { t } = useTranslation();
  const toFailure = useRecruiterError();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [job, setJob] = useState<OrgJob | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((value) => value + 1), []);
  useDocumentTitle(job?.title || t("recruiter.jobs.title"));

  useEffect(() => {
    if (!org) return;
    let active = true;
    recruiterApi(org).job(id).then((value) => active && setJob({ ...value, organization_id: org })).catch((error) => active && setFailure(toFailure(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, id]);

  if (!org) return <Notice tone="info">{t("recruiter.noOrg")}</Notice>;
  const api = recruiterApi(org);
  const withOrg = (value: OrgJobDetail): OrgJob => ({ ...value, organization_id: org });

  async function remove() {
    if (!org || !job) return;
    try {
      await api.deleteJob(job.id);
      navigate("/account/jobs");
    } catch (error) {
      setFailure(toFailure(error));
    }
  }

  return (
    <div className="candidate-page">
      <Link to="/account/jobs" className="back-link"><ArrowLeft size={15} aria-hidden="true" />{t("recruiter.jobs.back")}</Link>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {!job ? (
        !failure && <div className="card account-card skeleton-stack" aria-busy="true"><Skeleton width="50%" height={26} /><Skeleton width="85%" /></div>
      ) : (
        <>
          <div className="page-heading">
            <div><h2 className="candidate-title">{job.title || t("recruiter.jobs.untitled")}</h2></div>
            <button type="button" className="button ghost" onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />{t("recruiter.job.delete")}</button>
          </div>
          <div className="account-grid">
            <Criteria<OrgJob>
              key={job.id}
              target={job}
              onChange={(next) => { setJob(next); bump(); }}
              api={{ save: async (jobId, requirements) => withOrg(await api.saveRequirements(jobId, requirements)), confirm: async (jobId) => withOrg(await api.confirmRequirements(jobId)) }}
            />
            <StatusCard org={org} job={job} onChange={(next) => setJob(withOrg(next))} />
          </div>
          {job.criteria_confirmed_at ? (
            <>
              <div className="account-grid">
                <ImportCard org={org} jobId={job.id} onProgress={bump} />
                <ReviewQueue org={org} jobId={job.id} refreshKey={refreshKey} onChange={bump} />
              </div>
              <RankingView org={org} jobId={job.id} refreshKey={refreshKey} />
            </>
          ) : (
            <Notice tone="info">{t("recruiter.job.criteriaFirst")}</Notice>
          )}
        </>
      )}
    </div>
  );
}
