import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BriefcaseBusiness, FlaskConical, UserRound } from "lucide-react";
import { Notice, useDocumentTitle } from "./shared";

export function Welcome() {
  const { t } = useTranslation();
  const location = useLocation();
  useDocumentTitle(t("welcome.title"));
  const principles = t("welcome.principles", { returnObjects: true }) as { title: string; body: string }[];
  const deleted = (location.state as { deleted?: boolean } | null)?.deleted;
  return (
    <div className="welcome">
      {deleted && <Notice tone="success">{t("welcome.deleted")}</Notice>}
      <section className="welcome-hero" aria-labelledby="welcome-heading">
        <span className="eyebrow">{t("welcome.eyebrow")}</span>
        <h1 id="welcome-heading">{t("welcome.heading")}</h1>
        <p className="welcome-lead">{t("welcome.lead")}</p>
        <div className="welcome-actions">
          <Link to="/register" className="button primary">{t("welcome.ctaRegister")}<ArrowRight size={16} aria-hidden="true" /></Link>
          <Link to="/" className="button secondary"><FlaskConical size={16} aria-hidden="true" />{t("welcome.ctaDemo")}</Link>
          <Link to="/login" className="text-button">{t("welcome.ctaLogin")}</Link>
        </div>
      </section>

      <section className="welcome-example card" aria-labelledby="example-heading">
        <h2 id="example-heading">{t("welcome.exampleTitle")}</h2>
        <p className="coverage-sample mono">{t("welcome.exampleCount")}</p>
        <p>{t("welcome.exampleCaption")}</p>
      </section>

      <section aria-labelledby="principles-heading">
        <h2 id="principles-heading" className="welcome-section-title">{t("welcome.principlesTitle")}</h2>
        <ul className="principle-grid">
          {principles.map((item, index) => (
            <li key={item.title} className="card">
              <span className="principle-index mono" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="spaces-heading">
        <h2 id="spaces-heading" className="welcome-section-title">{t("welcome.spacesTitle")}</h2>
        <div className="space-grid">
          <article className="card space-card">
            <UserRound size={22} aria-hidden="true" />
            <h3>{t("welcome.candidate.title")}</h3>
            <p>{t("welcome.candidate.body")}</p>
          </article>
          <article className="card space-card">
            <BriefcaseBusiness size={22} aria-hidden="true" />
            <h3>{t("welcome.recruiter.title")}</h3>
            <p>{t("welcome.recruiter.body")}</p>
          </article>
        </div>
      </section>
    </div>
  );
}
