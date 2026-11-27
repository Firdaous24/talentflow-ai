import type { JobAnalysisResponse } from "../../jobTypes";
import { metadataFields } from "./shared";

export function JobMetadata({ analysis }: { analysis: JobAnalysisResponse }) {
  return (
    <dl className="job-summary">
      {metadataFields.map(({ field, label }) => {
        const evidence = analysis.job.metadata_evidence?.[field] ?? [];
        return (
          <div key={field}>
            <dt>{label}</dt>
            <dd>
              {analysis.job[field] ?? "Not provided explicitly"}
              {evidence.length > 0 && (
                <details className="job-source job-metadata-source">
                  <summary>
                    {field === "work_mode"
                      ? "Work mode source and schedule"
                      : `${label} source evidence`}
                  </summary>
                  {evidence.map((excerpt, index) => (
                    <blockquote key={index}>
                      {excerpt.quote}
                      <small>
                        Source characters {excerpt.start}–{excerpt.end}
                      </small>
                    </blockquote>
                  ))}
                </details>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

