import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Skeleton } from "../components/ui";
import { formatDate } from "./candidate/shared";
import { applicationsApi } from "./recruiter/api";
import { Notice, useDocumentTitle, useErrorText } from "./shared";

/**
 * Claim link for a CV imported by an organization (decision A2). The link alone
 * lets its holder delete the imported profile at once; claiming it needs a
 * candidate account. Nothing is stored in the browser.
 */
export function Claim() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const { state } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  useDocumentTitle(t("claim.title"));
  const [info, setInfo] = useState<{ organization: string; job_title: string | null; expires_at: string } | null>(null);
  const [outcome, setOutcome] = useState<"invalid" | "deleted" | "claimed" | null>(token ? null : "invalid");
  const [failure, setFailure] = useState<{ text: string; tone: "warning" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    applicationsApi.inspectClaim(token).then(setInfo).catch(() => setOutcome("invalid"));
  }, [token]);

  async function act(action: "delete" | "claim") {
    setBusy(true);
    setFailure(null);
    try {
      if (action === "delete") await applicationsApi.deleteByClaim(token);
      else await applicationsApi.acceptClaim(token);
      setOutcome(action === "delete" ? "deleted" : "claimed");
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const signedIn = state.status === "authenticated";
  const candidate = signedIn && state.account.role === "candidate";
  return (
    <div className="auth-page">
      <section className="card auth-panel" aria-labelledby="claim-heading">
        <span className="auth-symbol" aria-hidden="true"><KeyRound size={22} /></span>
        <h1 id="claim-heading">{t("claim.title")}</h1>
        <p>{t("claim.lead")}</p>
        {outcome === "invalid" && <Notice tone="warning">{token ? t("claim.invalid") : t("claim.missing")}</Notice>}
        {outcome === "deleted" && <Notice tone="success">{t("claim.deleted")}</Notice>}
        {outcome === "claimed" && (
          <Notice tone="success">
            {t("claim.claimed")} <Link to="/account/cv">{t("claim.toCv")}</Link>
          </Notice>
        )}
        {!outcome && !info && <Skeleton width="80%" />}
        {!outcome && info && (
          <>
            <p className="claim-info">{t("claim.info", { organization: info.organization, job: info.job_title ?? "—", date: formatDate(info.expires_at, i18n.language) })}</p>
            {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
            <div className="auth-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={() => void act("delete")}>{t("claim.delete")}</button>
            </div>
            <p className="subtle">{t("claim.claimHint")}</p>
            {candidate ? (
              <button type="button" className="button primary" disabled={busy} onClick={() => void act("claim")}>{t("claim.claim")}</button>
            ) : signedIn ? (
              <p className="subtle">{t("claim.recruiterAccount")}</p>
            ) : (
              <p className="subtle">
                {t("claim.signIn")} <Link to="/login">{t("claim.login")}</Link> · <Link to="/register/candidate">{t("claim.register")}</Link>
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
