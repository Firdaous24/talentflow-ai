import { useTranslation } from "react-i18next";
import { AuthApiError } from "../../auth/api";
import type { CVStatus } from "../../auth/api";
import { StatusPill } from "../../components/ui";
import { useErrorText } from "../shared";

export type Failure = { text: string; tone: "warning" | "error" } | null;

export function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(value));
}

/** Known candidate-space codes get a translated sentence; anything else falls back to the shared mapping. */
export function useCandidateError() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  return (error: unknown): Failure => {
    if (error instanceof AuthApiError) {
      const key = `candidate.errors.${error.code}`;
      if (i18n.exists(key)) return { text: t(key), tone: error.status >= 500 ? "error" : "warning" };
      const blocked = `candidate.blocked.${error.code}`;
      if (i18n.exists(blocked)) return { text: t(blocked), tone: "warning" };
    }
    return errorText(error);
  };
}

/** A CV version's review state, with an icon and words (never colour alone). */
export function VersionStatus({ status }: { status: CVStatus }) {
  const { t } = useTranslation();
  return <StatusPill status={status === "confirmed" ? "documented" : status === "reviewed" ? "accent" : "neutral"}>{t(`candidate.status.${status}`)}</StatusPill>;
}
