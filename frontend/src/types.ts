// Mirrors backend/app/models/candidate.py. Dates and HttpUrl serialize as strings.
export type SkillCategory =
  | "programming_language"
  | "framework"
  | "database"
  | "ai_ml"
  | "cloud_devops"
  | "tool"
  | "web_technology";
export interface WorkExperience {
  job_title: string | null;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  technologies: string[];
}
export interface Education {
  degree: string | null;
  institution: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
}
export interface Project {
  name: string | null;
  description: string | null;
  technologies: string[];
  github_url: string | null;
}
export interface CandidateProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  education: Education[];
  experience: WorkExperience[];
  technical_skills: { name: string; category: SkillCategory }[];
  projects: Project[];
  languages: { name: string; proficiency: string | null }[];
  certifications: {
    name: string;
    issuer: string | null;
    date: string | null;
  }[];
}
export interface CVParsingResponse {
  candidate: CandidateProfile;
  parsing_metadata: {
    status: "partial";
    page_count: number;
    warnings: string[];
    engine: "deterministic-v1" | "deterministic-v2" | "llm";
    evidence?: FieldEvidence[];
    llm_status?: "not_requested" | "succeeded" | "fallback";
  };
}
export interface HealthResponse {
  status: "ok";
}
export interface SessionCandidate extends CVParsingResponse {
  id: string;
  filename: string;
  parsedAt: string;
  reviewedCandidate?: CandidateProfile;
  confirmed?: boolean;
  correctedFields?: string[];
}
export interface FieldEvidence {
  field: string;
  quote: string;
  source_id: string;
  page: number;
  bbox: [number, number, number, number] | null;
  method: "labeled" | "header" | "layout" | "dictionary" | "llm";
  uncertain: boolean;
}
export interface ExtractionConfig {
  available: boolean;
  provider: string | null;
  destination: string | null;
  model: string | null;
  connectivity: "not_checked";
}
