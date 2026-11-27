import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, CircleHelp, Info, Minus } from "lucide-react";
import { Passage, passageContext, spanMatches } from "../../components/EvidencePassage";
import { Badge, StatusPill } from "../../components/ui";
import type { CandidateRequirementEvidence, RequirementComparison, RequirementEvidence } from "../../jobTypes";
import type { CoverageReport, Gap } from "./api";

/**
 * Documentary coverage: counted criteria and their evidence, side by side.
 * No score, percentage or gauge. "Not documented" is a neutral absence (grey,
 * dashed), never red. The highlighted span is the only text of each quotation.
 */
type Filter = "all" | "required" | "preferred" | "unspecified" | "needs_review";

function Offsets({ start, end }: { start?: number; end?: number }) {
  const { t } = useTranslation();
  return <span className="offset-badge" aria-hidden="true">{start === undefined || end === undefined ? t("candidate.coverage.wholeField") : t("candidate.coverage.chars", { start, end })}</span>;
}

function JobSide({ evidence, source }: { evidence: RequirementEvidence; source: string }) {
  const { t } = useTranslation();
  const exact = spanMatches(source, evidence.start, evidence.end, evidence.quote);
  return (
    <figure className="evidence-doc job">
      <figcaption className="evidence-doc-head"><span>{t("candidate.coverage.jobSide")}</span><Offsets start={evidence.start} end={evidence.end} /></figcaption>
      <Passage parts={exact ? passageContext(source, evidence.start, evidence.end) : undefined}>
        <blockquote className="evidence-hit">
          {evidence.quote}
          <small className="visually-hidden">{t("candidate.coverage.sourceChars", { start: evidence.start, end: evidence.end })}</small>
        </blockquote>
      </Passage>
    </figure>
  );
}

function CvSide({ evidence }: { evidence: CandidateRequirementEvidence }) {
  const { t } = useTranslation();
  const span = evidence.excerpt && spanMatches(evidence.quote, evidence.excerpt.start, evidence.excerpt.end, evidence.excerpt.quote) ? evidence.excerpt : undefined;
  return (
    <figure className="evidence-doc cv">
      <figcaption className="evidence-doc-head"><span>{t("candidate.coverage.cvField", { field: evidence.field })}</span><Offsets start={span?.start} end={span?.end} /></figcaption>
      <Passage parts={span ? passageContext(evidence.quote, span.start, span.end) : undefined}>
        <blockquote className="evidence-hit">{span ? span.quote : evidence.quote}</blockquote>
      </Passage>
    </figure>
  );
}

const STATUS_ICON = { documented: Check, needs_review: CircleHelp, not_documented: Minus };

function Criterion({ item, source }: { item: RequirementComparison; source: string }) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[item.status];
  return (
    <article className={`coverage-item ${item.status}`} aria-label={item.requirement_text}>
      <header className="coverage-item-head">
        <h4>{item.requirement_text}</h4>
        <Badge tone="neutral">{t(`candidate.offer.classifications.${item.classification}`)}</Badge>
        <StatusPill status={item.status}>{t(`candidate.coverage.status.${item.status}`)}</StatusPill>
      </header>
      <div className="evidence-pair">
        <div className="evidence-column">
          {item.job_evidence.map((evidence, index) => <JobSide key={index} evidence={evidence} source={source} />)}
        </div>
        <div className="evidence-bridge" aria-hidden="true"><span className={`evidence-bridge-mark ${item.status}`}><Icon size={14} /></span></div>
        <div className="evidence-column">
          <h5>{t("candidate.coverage.cvSide")}</h5>
          {item.candidate_evidence.length ? (
            item.candidate_evidence.map((evidence, index) => <CvSide key={index} evidence={evidence} />)
          ) : (
            <div className="evidence-absent"><Minus size={16} aria-hidden="true" /><p className="comparison-empty-evidence">{t("candidate.coverage.noCvEvidence")}</p></div>
          )}
        </div>
      </div>
    </article>
  );
}

export function CoverageView({ report, source }: { report: CoverageReport; source: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const counted = report.comparisons.filter((item) => item.origin === "qualification");
  const environment = report.comparisons.filter((item) => item.origin === "technical_environment");
  const shown = counted.filter((item) => filter === "all" || (filter === "needs_review" ? item.status === "needs_review" : item.classification === filter));
  const { counts } = report;
  const parts: { id: Filter; value: string; label: string }[] = [
    { id: "required", value: `${counts.required_documented}/${counts.required_total}`, label: t("candidate.coverage.required") },
    { id: "preferred", value: `${counts.preferred_documented}/${counts.preferred_total}`, label: t("candidate.coverage.preferred") },
    ...(counts.unspecified_total ? [{ id: "unspecified" as Filter, value: `${counts.unspecified_documented}/${counts.unspecified_total}`, label: t("candidate.coverage.unspecified") }] : []),
    { id: "needs_review", value: String(counts.needs_review), label: t("candidate.coverage.needsReview") },
  ];

  return (
    <section className="card account-card coverage" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">{t("candidate.coverage.title")}</h2>
      <p className="coverage-notice" role="note"><Info size={16} aria-hidden="true" />{t("candidate.coverage.notice", { number: report.cv_version.number })}</p>
      <div className="coverage-count" role="group" aria-label={t("candidate.coverage.summary")}>
        {parts.map((part, index) => (
          <span key={part.id} className="coverage-count-part">
            {index > 0 && <span aria-hidden="true" className="coverage-sep"> · </span>}
            <button type="button" aria-pressed={filter === part.id} aria-label={t("candidate.coverage.show", { label: `${part.value} ${part.label}` })} onClick={() => setFilter(filter === part.id ? "all" : part.id)}>
              <strong>{part.value}</strong> {part.label}
            </button>
          </span>
        ))}
      </div>
      {filter !== "all" && (
        <p className="subtle" role="status">
          {t("candidate.coverage.filtered", { count: shown.length })} ·{" "}
          <button type="button" className="link-button" onClick={() => setFilter("all")}>{t("candidate.coverage.showAll")}</button>
        </p>
      )}
      <div className="coverage-list">
        {shown.map((item) => <Criterion key={item.requirement_id} item={item} source={source} />)}
      </div>
      {environment.length > 0 && (
        <details className="coverage-environment">
          <summary>{t("candidate.coverage.environmentTitle")}</summary>
          <p className="subtle">{t("candidate.coverage.environmentNote")}</p>
          {environment.map((item) => <Criterion key={item.requirement_id} item={item} source={source} />)}
        </details>
      )}
    </section>
  );
}

export function GapsView({ gaps }: { gaps: Gap[] }) {
  const { t } = useTranslation();
  return (
    <section className="card account-card gaps" aria-labelledby="gaps-heading">
      <h2 id="gaps-heading">{t("candidate.gaps.title")}</h2>
      <p>{t("candidate.gaps.lead")}</p>
      {gaps.length === 0 ? (
        <p>{t("candidate.gaps.none")}</p>
      ) : (
        <ul className="gap-list">
          {gaps.map((gap) => {
            const section = t(`candidate.profile.sections.${gap.section}`);
            return (
              <li key={gap.requirement_id} className={gap.status}>
                <div className="gap-head">
                  <strong>{gap.requirement_text}</strong>
                  <StatusPill status={gap.status}>{t(`candidate.coverage.status.${gap.status}`)}</StatusPill>
                </div>
                <p>{gap.kind === "add_if_true" ? t("candidate.gaps.add_if_true") : t(`candidate.gaps.interpretation.${gap.reason ?? "context"}`)}</p>
                <Link to={`/account/cv#cv-section-${gap.section}`} className="gap-link">
                  {t("candidate.gaps.toSection", { section })}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
