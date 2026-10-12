import type { CVParsingResponse } from "../types";
export const syntheticProfile: CVParsingResponse = {
  candidate: {
    full_name: "Alex Example",
    email: "alex@example.com",
    phone: null,
    github_url: "https://github.com/example",
    linkedin_url: null,
    education: [
      {
        degree: "BSc",
        institution: "Example University",
        field_of_study: "Computing",
        start_date: "2020",
        end_date: "2023",
      },
    ],
    experience: [
      {
        job_title: "Developer",
        company: "Synthetic Company",
        location: null,
        start_date: "2023",
        end_date: "Present",
        description: "Built a demonstration app.",
        technologies: ["Python"],
      },
    ],
    technical_skills: [{ name: "Python", category: "programming_language" }],
    projects: [
      {
        name: "Demo project",
        description: null,
        technologies: [],
        github_url: null,
      },
    ],
    languages: [{ name: "English", proficiency: null }],
    certifications: [
      { name: "Example Certification", issuer: null, date: null },
    ],
  },
  parsing_metadata: {
    status: "partial",
    engine: "deterministic-v1",
    page_count: 1,
    warnings: ["Synthetic extraction warning."],
  },
};
export const pdfFile = () =>
  new File(["%PDF-1.7\nsynthetic test document"], "synthetic.pdf", {
    type: "application/pdf",
  });
