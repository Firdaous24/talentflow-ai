import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import type { CandidateProfile, SkillCategory } from "../../types";
import type { ProfileSection } from "./api";

/**
 * The candidate edits their own extracted profile. Nothing is suggested or
 * generated: every value comes from the extraction or from the candidate.
 * Dates and other fields not shown here are kept as extracted.
 */
type FieldName = "degree" | "institution" | "field_of_study" | "job_title" | "company" | "description" | "technologies" | "name" | "category" | "proficiency" | "issuer";
type Item = Record<string, unknown>;

const CONTACT = ["full_name", "email", "phone", "linkedin_url", "github_url"] as const;
const SKILL_CATEGORIES: SkillCategory[] = ["programming_language", "framework", "database", "ai_ml", "cloud_devops", "tool", "web_technology"];
export const SECTIONS: { id: ProfileSection; fields: FieldName[]; required?: FieldName; blank: Item }[] = [
  { id: "technical_skills", fields: ["name", "category"], required: "name", blank: { name: "", category: "tool" } },
  { id: "experience", fields: ["job_title", "company", "description", "technologies"], blank: { job_title: null, company: null, location: null, start_date: null, end_date: null, description: null, technologies: [] } },
  { id: "education", fields: ["degree", "field_of_study", "institution"], blank: { degree: null, institution: null, field_of_study: null, start_date: null, end_date: null } },
  { id: "projects", fields: ["name", "description", "technologies"], blank: { name: null, description: null, technologies: [], github_url: null } },
  { id: "certifications", fields: ["name", "issuer"], required: "name", blank: { name: "", issuer: null, date: null } },
  { id: "languages", fields: ["name", "proficiency"], required: "name", blank: { name: "", proficiency: null } },
];

/** Trims values, turns empty optional fields into null and drops items left empty. */
export function normalizeProfile(profile: CandidateProfile): CandidateProfile {
  const clean = (value: unknown) => (typeof value === "string" ? value.trim() || null : value);
  const next: Record<string, unknown> = { ...profile };
  for (const field of CONTACT) next[field] = clean(profile[field]);
  for (const section of SECTIONS) {
    const items = (profile[section.id] as unknown as Item[]).map((item) => {
      const copy: Item = {};
      for (const [key, value] of Object.entries(item)) {
        copy[key] = key === "technologies" && Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : key === "category" ? value : clean(value);
      }
      return copy;
    });
    next[section.id] = items.filter((item) => (section.required ? !!item[section.required] : section.fields.some((field) => (Array.isArray(item[field]) ? (item[field] as unknown[]).length > 0 : !!item[field]))));
  }
  return next as unknown as CandidateProfile;
}

function TextInput({ label, value, onChange, readOnly, multiline }: { label: string; value: string; onChange: (value: string) => void; readOnly: boolean; multiline?: boolean }) {
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} value={value} rows={3} maxLength={2000} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} value={value} maxLength={2000} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

export function ProfileEditor({ value, onChange, readOnly }: { value: CandidateProfile; onChange: (value: CandidateProfile) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const update = (patch: Partial<CandidateProfile>) => onChange({ ...value, ...patch });
  const items = (section: ProfileSection) => value[section] as unknown as Item[];
  const setItems = (section: ProfileSection, next: Item[]) => update({ [section]: next } as Partial<CandidateProfile>);

  return (
    <div className="profile-editor">
      <fieldset className="profile-section" id="cv-section-contact">
        <legend>{t("candidate.profile.contact")}</legend>
        <p className="subtle">{t("candidate.profile.contactNote")}</p>
        <div className="profile-fields">
          {CONTACT.map((field) => (
            <TextInput key={field} label={t(`candidate.profile.${field}`)} value={value[field] ?? ""} readOnly={readOnly} onChange={(next) => update({ [field]: next } as Partial<CandidateProfile>)} />
          ))}
        </div>
      </fieldset>
      {SECTIONS.map((section) => {
        const sectionLabel = t(`candidate.profile.sections.${section.id}`);
        const list = items(section.id);
        return (
          <fieldset key={section.id} className="profile-section" id={`cv-section-${section.id}`} tabIndex={-1}>
            <legend>{sectionLabel}</legend>
            {list.length === 0 && <p className="subtle">{t("candidate.profile.empty")}</p>}
            {list.map((item, index) => {
              const itemLabel = t("candidate.profile.item", { section: sectionLabel, index: index + 1 });
              const set = (field: string, next: unknown) => setItems(section.id, list.map((entry, position) => (position === index ? { ...entry, [field]: next } : entry)));
              return (
                <div key={index} className="profile-item" role="group" aria-label={itemLabel}>
                  <div className="profile-fields">
                    {section.fields.map((field) => {
                      const label = t(`candidate.profile.fields.${field}`);
                      if (field === "category")
                        return (
                          <div className="auth-field" key={field}>
                            <label htmlFor={`${section.id}-${index}-category`}>{label}</label>
                            <select id={`${section.id}-${index}-category`} value={String(item.category)} disabled={readOnly} onChange={(event) => set("category", event.target.value)}>
                              {SKILL_CATEGORIES.map((category) => <option key={category} value={category}>{t(`candidate.profile.skillCategories.${category}`)}</option>)}
                            </select>
                          </div>
                        );
                      if (field === "technologies")
                        return <TextInput key={field} label={label} readOnly={readOnly} value={((item.technologies as string[]) ?? []).join(", ")} onChange={(next) => set("technologies", next.split(",").map((entry) => entry.trimStart()))} />;
                      return <TextInput key={field} label={label} readOnly={readOnly} multiline={field === "description"} value={(item[field] as string | null) ?? ""} onChange={(next) => set(field, next)} />;
                    })}
                  </div>
                  {!readOnly && (
                    <button type="button" className="icon-button profile-remove" aria-label={t("candidate.profile.remove", { index: index + 1, section: sectionLabel })} onClick={() => setItems(section.id, list.filter((_, position) => position !== index))}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <button type="button" className="button ghost profile-add" onClick={() => setItems(section.id, [...list, { ...section.blank }])}>
                <Plus size={15} aria-hidden="true" />
                {t("candidate.profile.add", { section: sectionLabel })}
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
