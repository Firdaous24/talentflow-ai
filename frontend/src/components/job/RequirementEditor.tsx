import type { JobRequirement, RequirementCategory, RequirementClassification, ReviewedRequirement } from "../../jobTypes";
import { categories, classificationLabels, classifications } from "./shared";
import { WarningList } from "./WarningList";

export function RequirementEditor({
  original,
  reviewed,
  disabled,
  onChange,
}: {
  original: JobRequirement;
  reviewed: ReviewedRequirement;
  disabled: boolean;
  onChange: (changes: Partial<ReviewedRequirement>) => void;
}) {
  const environment = original.origin === "technical_environment";
  const changed =
    original.text !== reviewed.text ||
    original.category !== reviewed.category ||
    original.classification !== reviewed.classification;
  return (
    <article
      className="job-requirement"
      aria-label={`Requirement ${original.id}`}
    >
      <div className="job-requirement-header">
        <h4>{original.text}</h4>
        <span className={`badge ${changed ? "violet" : "gray"}`}>
          {changed ? "Human correction" : "Original extraction"}
        </span>
      </div>
      <label htmlFor={`text-${original.id}`}>
        Requirement text {original.id}
      </label>
      <textarea
        id={`text-${original.id}`}
        value={reviewed.text}
        disabled={disabled}
        maxLength={2000}
        rows={2}
        onChange={(event) => onChange({ text: event.target.value })}
      />
      <div className="job-requirement-fields">
        <div>
          <label htmlFor={`classification-${original.id}`}>
            Classification {original.id}
          </label>
          <select
            id={`classification-${original.id}`}
            value={reviewed.classification}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                classification: event.target.value as RequirementClassification,
              })
            }
          >
            {classifications.map((classification) => (
              <option key={classification} value={classification}>
                {classificationLabels[classification]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`category-${original.id}`}>
            Category {original.id}
          </label>
          <select
            id={`category-${original.id}`}
            value={reviewed.category}
            disabled={disabled}
            onChange={(event) =>
              onChange({ category: event.target.value as RequirementCategory })
            }
          >
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="job-review-changes">
        Original: {classificationLabels[original.classification]} ·{" "}
        {categories[original.category]}
      </p>
      {environment && (
        <p className="job-environment-explanation">
          Listed in the technical environment. This mention alone does not
          establish a mandatory candidate qualification.
          {original.classification !== reviewed.classification && (
            <span>
              {" "}
              The edited classification is your reviewed interpretation; the
              original environment mention remains subject to human review
              during comparison.
            </span>
          )}
        </p>
      )}
      {original.technical_skills.length > 0 && (
        <div className="tags" aria-label="Source technical skills">
          {original.technical_skills.map((skill) => (
            <span className="tag" key={skill.name}>
              {skill.name}
            </span>
          ))}
        </div>
      )}
      <details className="job-source">
        <summary>Job source evidence</summary>
        {original.evidence.map((evidence, index) => (
          <blockquote key={index}>
            {evidence.quote}
            <small>
              Source characters {evidence.start}–{evidence.end}
            </small>
          </blockquote>
        ))}
      </details>
      <WarningList warnings={original.warnings} />
    </article>
  );
}

