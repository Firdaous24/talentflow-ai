import { useState } from "react";
import type { FormEvent } from "react";
import type {
  CandidateProfile,
  SessionCandidate,
  SkillCategory,
} from "../types";
import { useSession } from "../session";
import { changedFields, validateReview } from "../review";
import { Profile } from "./Profile";

const categories: SkillCategory[] = [
  "programming_language",
  "framework",
  "database",
  "ai_ml",
  "cloud_devops",
  "tool",
  "web_technology",
];
const templates = {
  education: {
    degree: null,
    institution: null,
    field_of_study: null,
    start_date: null,
    end_date: null,
  },
  experience: {
    job_title: null,
    company: null,
    location: null,
    start_date: null,
    end_date: null,
    description: null,
    technologies: [],
  },
  projects: {
    name: null,
    description: null,
    technologies: [],
    github_url: null,
  },
  technical_skills: { name: "", category: "tool" },
  languages: { name: "", proficiency: null },
  certifications: { name: "", issuer: null, date: null },
};
type Collection = keyof typeof templates;
const labels: Record<string, string> = {
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  linkedin_url: "LinkedIn URL",
  github_url: "GitHub URL",
  degree: "Degree",
  institution: "Institution",
  field_of_study: "Field of study",
  start_date: "Start date",
  end_date: "End date",
  job_title: "Position",
  company: "Organization",
  location: "Location",
  description: "Description",
  technologies: "Technologies (comma separated)",
  name: "Name",
  proficiency: "Proficiency",
  issuer: "Issuer",
  date: "Date",
  category: "Category",
};
const collectionLabels: Record<Collection, string> = {
  education: "education",
  experience: "experience",
  projects: "project",
  technical_skills: "skill",
  languages: "language",
  certifications: "certification",
};
const clone = (value: CandidateProfile): CandidateProfile =>
  JSON.parse(JSON.stringify(value));

export function ReviewProfile({ entry }: { entry: SessionCandidate }) {
  const { candidates, reviewCandidate } = useSession();
  const current = candidates.find((item) => item.id === entry.id) ?? entry;
  const profile = current.reviewedCandidate ?? current.candidate;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => clone(profile));
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const corrections = changedFields(current.candidate, draft);
  function update(path: string, value: unknown) {
    setDraft((previous) => {
      const next = clone(previous);
      const parts = path.split(".");
      let target = next as unknown as Record<string, unknown>;
      for (const key of parts.slice(0, -1))
        target = target[key] as Record<string, unknown>;
      target[parts.at(-1)!] = value;
      return next;
    });
    setAcknowledged(false);
    setMessage("");
  }
  function save(event: FormEvent, confirm = false) {
    event.preventDefault();
    const problem = validateReview(draft);
    setError(problem);
    if (problem || (confirm && !acknowledged)) return;
    reviewCandidate(current.id, clone(draft), confirm);
    setEditing(false);
    setMessage(
      confirm
        ? "Profile confirmed for this session. Future matching is not implemented."
        : "Corrections saved in this session. Review confirmation is still required.",
    );
  }
  function field(path: string, key: string, value: unknown, required = false) {
    const evidence =
      current.parsing_metadata.evidence?.filter(
        (item) => item.field === path,
      ) ?? [];
    const status = corrections.includes(path)
      ? "User-corrected"
      : value === null ||
          value === "" ||
          (Array.isArray(value) && !value.length)
        ? "Missing"
        : evidence.some((item) => item.uncertain) || !evidence.length
          ? "Extracted · review required"
          : "Extracted";
    const id = `review-${current.id}-${path}`;
    const props = {
      id,
      value: Array.isArray(value) ? value.join(", ") : String(value ?? ""),
      onChange: (
        event: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) =>
        update(
          path,
          Array.isArray(value)
            ? event.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            : event.target.value.trim() === ""
              ? required
                ? ""
                : null
              : event.target.value,
        ),
      required,
      maxLength: key === "email" ? 254 : 2000,
    };
    return (
      <div className="review-field" key={path}>
        <div>
          <label htmlFor={id}>{labels[key] ?? key}</label>
          <span
            className={`badge ${status === "User-corrected" ? "violet" : "neutral"}`}
          >
            {status}
          </span>
        </div>
        {key === "category" ? (
          <select id={id} value={String(value)} onChange={props.onChange}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        ) : key === "description" ? (
          <textarea {...props} rows={3} />
        ) : (
          <input
            {...props}
            type={key === "email" ? "email" : "text"}
            placeholder={
              key.includes("date") || key === "date"
                ? "YYYY / YYYY-MM / Present"
                : "Not extracted — enter if known"
            }
          />
        )}
        {evidence.length > 0 && (
          <details>
            <summary>Source evidence · page {evidence[0].page}</summary>
            {evidence.map((source, i) => (
              <blockquote key={i}>
                {source.quote}
                <small>
                  {source.source_id} · {source.method}
                </small>
              </blockquote>
            ))}
          </details>
        )}
      </div>
    );
  }
  return (
    <>
      <section className="card review-banner">
        <div>
          <h2>
            {current.confirmed ? "Profile confirmed" : "Human review required"}
          </h2>
          <p>
            {current.correctedFields?.length ?? 0} corrected fields ·{" "}
            {current.confirmed
              ? "Confirmed in this session only"
              : "Extraction has not been confirmed"}
            . Original extraction is kept for comparison.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setDraft(clone(profile));
            setEditing(!editing);
            setAcknowledged(false);
            setError(null);
          }}
        >
          {editing ? "Close review" : "Review & correct profile"}
        </button>
      </section>
      {message && (
        <p className="notice info" role="status">
          {message}
        </p>
      )}
      {editing && (
        <form
          className="card review-editor"
          aria-label="Review candidate profile"
          onSubmit={(event) => save(event)}
        >
          <h2>Review candidate profile</h2>
          <p>
            Extracted, missing and user-corrected values are labeled below.
            Dictionary mentions do not verify proficiency. Confirmation records
            your review only; it does not run matching.
          </p>
          <div className="review-fields">
            {["full_name", "email", "phone", "linkedin_url", "github_url"].map(
              (key) => field(key, key, draft[key as keyof CandidateProfile]),
            )}
          </div>
          {(Object.keys(templates) as Collection[]).map((collection) => (
            <section className="review-collection" key={collection}>
              <h3>{collection.replaceAll("_", " ")}</h3>
              {draft[collection].map((item, index) => (
                <div className="review-record" key={index}>
                  <div className="review-fields">
                    {Object.entries(item).map(([key, value]) =>
                      field(
                        `${collection}.${index}.${key}`,
                        key,
                        value,
                        key === "name" &&
                          [
                            "technical_skills",
                            "languages",
                            "certifications",
                          ].includes(collection),
                      ),
                    )}
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      update(
                        collection,
                        draft[collection].filter((_item, i) => i !== index),
                      )
                    }
                  >
                    Remove {collectionLabels[collection]} {index + 1}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  update(collection, [
                    ...draft[collection],
                    { ...templates[collection] },
                  ])
                }
              >
                Add {collectionLabels[collection]}
              </button>
            </section>
          ))}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <label className="consent-label">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I reviewed the fields, source evidence and extraction warnings.
          </label>
          <div className="review-actions">
            <button className="button secondary" type="submit">
              Save corrections
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!acknowledged}
              onClick={(event) => save(event, true)}
            >
              Confirm reviewed profile
            </button>
          </div>
        </form>
      )}
      <Profile
        result={{ ...current, candidate: profile }}
        reviewed={!!current.reviewedCandidate}
      />
    </>
  );
}
