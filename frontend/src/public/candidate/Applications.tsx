import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { AuthApiError } from "../../auth/api";
import { Badge, Skeleton, StatusPill } from "../../components/ui";
import { Notice } from "../shared";
import { applicationsApi } from "../recruiter/api";
import type { Application, PublicJob } from "../recruiter/api";
import { formatDate, useCandidateError } from "./shared";
import type { Failure } from "./shared";

/** Public offers and the candidate's applications. Applying requires the recruiter-visibility consent. */
export function PublicOffers() {
  const { t, i18n } = useTranslation();
  const toCandidateFailure = useCandidateError();
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const toFailure = (error: unknown): Failure =>
    error instanceof AuthApiError && i18n.exists(`applications.errors.${error.code}`) ? { text: t(`applications.errors.${error.code}`), tone: "warning" } : toCandidateFailure(error);

  const refresh = useCallback(async () => {
    const [nextJobs, nextApplications] = await Promise.all([applicationsApi.publicJobs(), applicationsApi.list()]);
    setJobs(nextJobs);
    setApplications(nextApplications);
  }, []);

  useEffect(() => {
    refresh().catch((error) => setFailure(toFailure(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setFailure(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setFailure(toFailure(error));
    }
  }

  return (
    <div className="account-grid">
      <section className="card account-card" aria-labelledby="public-jobs-heading">
        <h2 id="public-jobs-heading"><Send size={19} aria-hidden="true" />{t("applications.publicTitle")}</h2>
        <p className="subtle">{t("applications.publicLead")}</p>
        {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
        {jobs === null ? (
          <Skeleton width="70%" />
        ) : jobs.length === 0 ? (
          <p>{t("applications.publicEmpty")}</p>
        ) : (
          <ul className="offer-list" aria-label={t("applications.publicTitle")}>
            {jobs.map((job) => (
              <li key={job.id}>
                <strong>{job.title || t("candidate.offers.untitled")}</strong>
                <span className="subtle">{job.organization} · {t("applications.criteria", { count: job.requirement_count })}</span>
                {job.applied ? (
                  <StatusPill status="documented">{t("applications.applied")}</StatusPill>
                ) : (
                  <button type="button" className="button secondary" aria-label={`${t("applications.apply")} · ${job.title ?? ""} · ${job.organization}`} onClick={() => void run(() => applicationsApi.apply(job.id))}>{t("applications.apply")}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card account-card" aria-labelledby="applications-heading">
        <h2 id="applications-heading">{t("applications.mineTitle")}</h2>
        {applications === null ? (
          <Skeleton width="60%" />
        ) : applications.length === 0 ? (
          <p>{t("applications.mineEmpty")}</p>
        ) : (
          <ul className="offer-list" aria-label={t("applications.mineTitle")}>
            {applications.map((application) => (
              <li key={application.id}>
                <strong>{application.job_title || t("candidate.offers.untitled")}</strong>
                <span className="subtle">{application.organization} · {formatDate(application.created_at, i18n.language)}</span>
                <Badge tone={application.visible_to_recruiters ? "green" : "neutral"}>{application.visible_to_recruiters ? t("applications.visible") : t("applications.hidden")}</Badge>
                <button type="button" className="button ghost" onClick={() => void run(() => applicationsApi.withdraw(application.id))}>{t("applications.withdraw")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
