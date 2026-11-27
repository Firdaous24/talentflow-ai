import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "./shared";

const POLICY_DATE = "2026-11-27";

export function Legal() {
  const { t, i18n } = useTranslation();
  const { page } = useParams();
  const known = page === "terms" || page === "privacy";
  const title = known ? t(page === "terms" ? "legal.termsTitle" : "legal.privacyTitle") : "";
  useDocumentTitle(title || "TalentFlow AI");
  if (!known) return <Navigate to="/legal/terms" replace />;
  const sections = t(`legal.${page}`, { returnObjects: true }) as { title: string; body: string }[];
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(`${POLICY_DATE}T12:00:00Z`));
  return (
    <article className="auth-page wide legal">
      <div className="auth-heading">
        <h1>{title}</h1>
        <p className="mono legal-version">{t("legal.version", { date })}</p>
      </div>
      {sections.map((section) => (
        <section key={section.title} className="legal-section">
          <h2>{section.title}</h2>
          <p>{section.body}</p>
        </section>
      ))}
    </article>
  );
}
