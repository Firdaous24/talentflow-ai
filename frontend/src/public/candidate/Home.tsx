import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, DownloadCloud, Route as RouteIcon } from "lucide-react";
import type { CandidateOverview, NextStep } from "../../auth/api";
import { Skeleton } from "../../components/ui";
import { Notice } from "../shared";
import { candidateApi, downloadJson } from "./api";
import { useCandidateError } from "./shared";
import type { Failure } from "./shared";

const STEPS: { id: NextStep; to: string }[] = [
  { id: "upload_cv", to: "/account/cv" },
  { id: "review_cv", to: "/account/cv" },
  { id: "add_target", to: "/account/offers" },
  { id: "review_criteria", to: "/account/offers" },
  { id: "view_coverage", to: "/account/offers" },
];

export function CandidateNav() {
  const { t } = useTranslation();
  return (
    <nav className="candidate-nav" aria-label={t("candidate.nav.label")}>
      <NavLink to="/account" end>{t("candidate.nav.overview")}</NavLink>
      <NavLink to="/account/cv">{t("candidate.nav.cv")}</NavLink>
      <NavLink to="/account/offers">{t("candidate.nav.offers")}</NavLink>
    </nav>
  );
}

/** The candidate's path, in the only order that leads to a coverage report. */
export function CandidateHome({ overview }: { overview: CandidateOverview | null }) {
  const { t } = useTranslation();
  if (!overview) return <section className="card account-card"><Skeleton width="60%" height={24} /><Skeleton width="85%" /></section>;
  const current = STEPS.findIndex((step) => step.id === overview.next_step);
  const next = STEPS[current];
  return (
    <section className="card account-card candidate-home" aria-labelledby="path-heading">
      <h2 id="path-heading"><RouteIcon size={19} aria-hidden="true" />{t("candidate.overview.title")}</h2>
      <p>{t("candidate.overview.lead")}</p>
      <ol className="path-steps">
        {STEPS.map((step, index) => {
          const done = index < current;
          return (
            <li key={step.id} className={done ? "done" : index === current ? "current" : "todo"} aria-current={index === current ? "step" : undefined}>
              <span className="path-marker" aria-hidden="true">{done ? <Check size={13} strokeWidth={2.75} /> : index + 1}</span>
              <span>{t(`candidate.overview.steps.${step.id}`)}</span>
              <span className="visually-hidden">{done ? t("candidate.overview.done") : t("candidate.overview.todo")}</span>
            </li>
          );
        })}
      </ol>
      <p className="subtle">
        {overview.current_version ? t("candidate.overview.cvState", { number: overview.current_version.number, status: t(`candidate.status.${overview.current_version.status}`) }) : t("candidate.overview.noCv")}
        {" · "}
        {overview.targets ? t("candidate.overview.targets", { count: overview.targets, confirmed: overview.confirmed_targets }) : t("candidate.overview.noTargets")}
      </p>
      <Link to={next.to} className="button primary" aria-label={t("candidate.overview.next", { step: t(`candidate.overview.steps.${next.id}`) })}>
        {t("candidate.overview.continue")}
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
      <p className="subtle">{t("candidate.overview.storage")}</p>
    </section>
  );
}

/** Portable export of every personal datum the account holds (any role). */
export function DataPanel() {
  const { t } = useTranslation();
  const toFailure = useCandidateError();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function exportData() {
    setBusy(true);
    setDone(false);
    setFailure(null);
    try {
      downloadJson(await candidateApi.exportData(), "talentflow-export.json");
      setDone(true);
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-card" aria-labelledby="data-heading">
      <h2 id="data-heading"><DownloadCloud size={19} aria-hidden="true" />{t("candidate.data.title")}</h2>
      <p>{t("candidate.data.body")}</p>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void exportData()}>{t("candidate.data.export")}</button>
      {done && <Notice tone="success">{t("candidate.data.exported")}</Notice>}
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </section>
  );
}
