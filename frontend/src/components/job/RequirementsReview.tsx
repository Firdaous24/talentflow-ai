import type { Dispatch, SetStateAction } from "react";
import { HelpCircle } from "lucide-react";
import type { JobSessionState } from "../../jobSession";
import type { ReviewedRequirement } from "../../jobTypes";
import { RequirementEditor } from "./RequirementEditor";
import { classificationLabels, classifications } from "./shared";
import { WarningList } from "./WarningList";

/** Reviewed requirement groups: qualifications by classification, then technical environment mentions. */
export function RequirementsReview({ state, setState, blocked, environmentRequirements, qualificationRequirements, ambiguousQualifications, editRequirement }: {
  state: JobSessionState & { analysis: NonNullable<JobSessionState["analysis"]> };
  setState: Dispatch<SetStateAction<JobSessionState>>;
  blocked: boolean;
  environmentRequirements: ReviewedRequirement[];
  qualificationRequirements: ReviewedRequirement[];
  ambiguousQualifications: boolean | undefined;
  editRequirement: (id: string, changes: Partial<ReviewedRequirement>) => void;
}) {
  return (
    <>
      <WarningList warnings={state.analysis.warnings} />
      {state.analysis.warnings.length > 0 && (
        <p className="job-analysis-status" role="status">
          Analysis completed with notes. Review the analysis notes and
          original evidence before confirming.
        </p>
      )}
      {!state.requirements.length ? (
        <div className="job-empty">
          <HelpCircle size={29} />
          <h3>
            No job-related qualifications or technical information
            detected
          </h3>
          <p>
            Check that the pasted description includes qualifications
            or a technical environment. Return to the source to add
            missing job text; no requirements have been invented.
          </p>
          <button
            className="button secondary"
            onClick={() =>
              setState((current) => ({ ...current, view: "source" }))
            }
          >
            Return to source description
          </button>
        </div>
      ) : (
        <>
          <p className="job-boundary" style={{ marginTop: 18 }}>
            Correct the wording and labels against the source.
            Technical skills and evidence remain tied to the original
            excerpt. Editing clears your confirmation. Unsupported
            additions are rejected by the comparison API.
          </p>
          {environmentRequirements.length > 0 &&
            qualificationRequirements.length === 0 && (
              <div className="notice info job-analysis-status">
                <HelpCircle size={18} />
                <div>
                  <strong>Technical environment extracted</strong>
                  <p>
                    No mandatory qualifications are explicitly stated.
                    Review the environment mentions below and return
                    to the source if qualification text is missing.
                    Environment evidence remains subject to human
                    interpretation during comparison.
                  </p>
                </div>
              </div>
            )}
          {ambiguousQualifications && (
            <p className="job-analysis-status">
              Some qualification classifications are unspecified.
              Their required or preferred status is unclear in the
              original source; review the excerpts before confirming.
            </p>
          )}
          {classifications.map((classification) => {
            const requirements = qualificationRequirements.filter(
              (requirement) =>
                requirement.classification === classification,
            );
            return (
              <section
                className="job-requirement-group"
                key={classification}
                aria-label={`${classificationLabels[classification]} criteria`}
              >
                <h3>
                  {classificationLabels[classification]} criteria
                  <span className="count">{requirements.length}</span>
                </h3>
                {requirements.length ? (
                  requirements.map((requirement) => {
                    const original =
                      state.analysis!.requirements.find(
                        (item) => item.id === requirement.id,
                      )!;
                    return (
                      <RequirementEditor
                        key={requirement.id}
                        original={original}
                        reviewed={requirement}
                        disabled={blocked}
                        onChange={(changes) =>
                          editRequirement(requirement.id, changes)
                        }
                      />
                    );
                  })
                ) : (
                  <p className="job-no-items">
                    No criteria in this section.
                  </p>
                )}
              </section>
            );
          })}
          {environmentRequirements.length > 0 && (
            <section
              className="job-requirement-group job-environment-group"
              aria-label="Technical environment mentions"
            >
              <h3>
                Technical environment mentions
                <span className="count">
                  {environmentRequirements.length}
                </span>
              </h3>
              <p className="job-boundary">
                These technologies appear in an environment or stack
                list. Their original requirement status is
                unspecified; they are separate from qualifications.
              </p>
              {environmentRequirements.map((requirement) => {
                const original = state.analysis!.requirements.find(
                  (item) => item.id === requirement.id,
                )!;
                return (
                  <RequirementEditor
                    key={requirement.id}
                    original={original}
                    reviewed={requirement}
                    disabled={blocked}
                    onChange={(changes) =>
                      editRequirement(requirement.id, changes)
                    }
                  />
                );
              })}
            </section>
          )}
        </>
      )}
    </>
  );
}
