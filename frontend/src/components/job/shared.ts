/** Job analysis labels and limits shared by the page and its sub-components. */
import type { JobMetadataField, RequirementCategory, RequirementClassification } from "../../jobTypes";

export const MIN_TEXT_LENGTH = 30;
export const MAX_TEXT_LENGTH = 30000;
export const classifications: RequirementClassification[] = [
  "required",
  "preferred",
  "unspecified",
];
export const classificationLabels: Record<RequirementClassification, string> = {
  required: "Required",
  preferred: "Preferred",
  unspecified: "Unspecified",
};
export const categories: Record<RequirementCategory, string> = {
  technical_skill: "Technical skill",
  experience: "Experience",
  education: "Education",
  certification: "Certification",
  language: "Language",
  other: "Other / needs review",
};
export const metadataFields: { field: JobMetadataField; label: string }[] = [
  { field: "title", label: "Job title" },
  { field: "company", label: "Company" },
  { field: "location", label: "Location" },
  { field: "employment_type", label: "Employment type" },
  { field: "work_mode", label: "Work mode" },
];

