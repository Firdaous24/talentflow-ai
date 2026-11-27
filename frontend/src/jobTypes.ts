import type { CandidateProfile, SkillCategory } from "./types";

export type RequirementCategory =
  | "technical_skill"
  | "experience"
  | "education"
  | "certification"
  | "language"
  | "other";
export type RequirementClassification =
  | "required"
  | "preferred"
  | "unspecified";
export type ComparisonStatus = "documented" | "not_documented" | "needs_review";
export type RequirementOrigin = "qualification" | "technical_environment";
export type JobMetadataField =
  | "title"
  | "company"
  | "location"
  | "employment_type"
  | "work_mode";
export interface RequirementEvidence {
  quote: string;
  start: number;
  end: number;
}
export interface JobRequirement {
  id: string;
  text: string;
  category: RequirementCategory;
  classification: RequirementClassification;
  origin: RequirementOrigin;
  technical_skills: { name: string; category: SkillCategory }[];
  evidence: RequirementEvidence[];
  warnings: string[];
}
export interface ReviewedRequirement {
  id: string;
  text: string;
  category: RequirementCategory;
  classification: RequirementClassification;
}
export interface JobAnalysisResponse {
  job: {
    title: string | null;
    company: string | null;
    location: string | null;
    employment_type: string | null;
    work_mode: string | null;
    metadata_evidence: Partial<Record<JobMetadataField, RequirementEvidence[]>>;
    text: string;
    responsibilities: string[];
  };
  requirements: JobRequirement[];
  warnings: string[];
  method: "deterministic-v1";
}
export interface QualificationProfile {
  education: { degree: string | null; field_of_study: string | null }[];
  experience: {
    job_title: string | null;
    description: string | null;
    technologies: string[];
  }[];
  technical_skills: CandidateProfile["technical_skills"];
  projects: {
    name: string | null;
    description: string | null;
    technologies: string[];
  }[];
  certifications: { name: string }[];
  languages: CandidateProfile["languages"];
}
export interface JobComparisonRequest {
  candidate: QualificationProfile;
  job_analysis: JobAnalysisResponse;
  requirements: ReviewedRequirement[];
  review: {
    candidate_confirmed: boolean;
    candidate_snapshot: QualificationProfile;
    requirements_reviewed: boolean;
    requirement_snapshot: ReviewedRequirement[];
  };
}
export interface CandidateRequirementEvidence {
  field: string;
  /** Full original reviewed field, retained for older clients. */
  quote: string;
  unverified: true;
  /** Exact source span; offsets count Unicode code points in quote. */
  excerpt?: { quote: string; start: number; end: number };
}
export interface RequirementComparison {
  requirement_id: string;
  requirement_text: string;
  original_requirement_text: string;
  category: RequirementCategory;
  classification: RequirementClassification;
  origin: RequirementOrigin;
  status: ComparisonStatus;
  candidate_evidence: CandidateRequirementEvidence[];
  job_evidence: RequirementEvidence[];
  explanation: string;
  review_notes: string[];
}
export interface TechnicalEvidence {
  name: string;
  category: SkillCategory;
  job_references: {
    requirement_id: string;
    origin: RequirementOrigin;
    classification: RequirementClassification;
    evidence: RequirementEvidence[];
  }[];
  candidate_evidence: RequirementComparison["candidate_evidence"];
  requires_interpretation: boolean;
}
export interface JobComparisonResponse {
  comparisons: RequirementComparison[];
  /** Additive source-grounded overview; older API responses may omit it. */
  technical_evidence?: TechnicalEvidence[];
  warnings: string[];
  review_assertion: "unverified_client_assertion";
  method: "qualification-document-checklist-v1";
}

/** Only qualification fields travel to the comparison API. Identity and contact fields stay out. */
export function qualificationSnapshot(
  candidate: CandidateProfile,
): QualificationProfile {
  return {
    education: candidate.education.map(({ degree, field_of_study }) => ({
      degree,
      field_of_study,
    })),
    experience: candidate.experience.map(
      ({ job_title, description, technologies }) => ({
        job_title,
        description,
        technologies: [...technologies],
      }),
    ),
    technical_skills: candidate.technical_skills.map((skill) => ({ ...skill })),
    projects: candidate.projects.map(({ name, description, technologies }) => ({
      name,
      description,
      technologies: [...technologies],
    })),
    certifications: candidate.certifications.map(({ name }) => ({ name })),
    languages: candidate.languages.map((language) => ({ ...language })),
  };
}
