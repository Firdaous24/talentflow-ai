import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
import { AuthApiError, authApi } from "../auth/api";
import { Notice, useDocumentTitle, useErrorText } from "./shared";

/** The token is consumed only on an explicit click, so link scanners and prefetching cannot use it up. */
export function VerifyEmail() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [failure, setFailure] = useState<{ text: string; tone: "warning" | "error" } | null>(null);
  useDocumentTitle(t("verify.title"));

  async function confirm() {
    if (!token) return;
    setState("busy");
    setFailure(null);
    try {
      await authApi.verifyEmail(token);
      setState("done");
    } catch (error) {
      setState("idle");
      setFailure(error instanceof AuthApiError && (error.code === "invalid_token" || error.code === "validation_error") ? { text: t("verify.invalid"), tone: "warning" } : errorText(error));
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-panel card" aria-labelledby="verify-heading">
        <span className="auth-symbol"><MailCheck size={26} aria-hidden="true" /></span>
        <h1 id="verify-heading">{t("verify.heading")}</h1>
        {state === "done" ? (
          <>
            <Notice tone="success">{t("verify.done")}</Notice>
            <Link to="/login" className="button primary auth-submit">{t("common.nav.login")}</Link>
          </>
        ) : token ? (
          <>
            <p>{t("verify.body")}</p>
            {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
            <button type="button" className="button primary auth-submit" disabled={state === "busy"} onClick={() => void confirm()}>{t("verify.confirm")}</button>
          </>
        ) : (
          <Notice tone="warning">{t("verify.missing")}</Notice>
        )}
      </section>
    </div>
  );
}
