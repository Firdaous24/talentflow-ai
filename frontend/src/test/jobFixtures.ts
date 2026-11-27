import type { JobAnalysisResponse, RequirementEvidence } from "../jobTypes";

// Fictional, independently authored API fixtures for UI behavior, not parser evaluation.
const workSchedule =
  "Le premier mois sera principalement réalisé en présentiel. À partir du deuxième mois, fonctionnement hybride.";
export const realisticJobText = `Poste : Architecte IA
Entreprise : Nuage Exemple
Rabat/Technopolis ➡ Contrat: CDI ➡ Mode de travail: ${workSchedule}
Compétences obligatoires
Python
Atouts
Docker
Qualifications
SQL
Environnement technique :
Azure AI / Azure OpenAI
Envoyez votre CV à recrutement@example.com
#Hiring #Recruitment`;

function evidence(quote: string): RequirementEvidence[] {
  const start = realisticJobText.indexOf(quote);
  return [{ quote, start, end: start + quote.length }];
}

export const realisticJobAnalysis: JobAnalysisResponse = {
  job: {
    title: "Architecte IA",
    company: "Nuage Exemple",
    location: "Rabat/Technopolis",
    employment_type: "CDI",
    work_mode: "Hybrid",
    metadata_evidence: {
      title: evidence("Architecte IA"),
      company: evidence("Nuage Exemple"),
      location: evidence("Rabat/Technopolis"),
      employment_type: evidence("CDI"),
      work_mode: evidence(workSchedule),
    },
    text: realisticJobText,
    responsibilities: [],
  },
  requirements: [
    {
      id: "req-001",
      text: "Python",
      category: "technical_skill",
      classification: "required",
      origin: "qualification",
      technical_skills: [{ name: "Python", category: "programming_language" }],
      evidence: evidence("Python"),
      warnings: [],
    },
    {
      id: "req-002",
      text: "Docker",
      category: "technical_skill",
      classification: "preferred",
      origin: "qualification",
      technical_skills: [{ name: "Docker", category: "cloud_devops" }],
      evidence: evidence("Docker"),
      warnings: [],
    },
    {
      id: "req-003",
      text: "SQL",
      category: "technical_skill",
      classification: "unspecified",
      origin: "qualification",
      technical_skills: [{ name: "SQL", category: "database" }],
      evidence: evidence("SQL"),
      warnings: [
        "The source does not state whether this criterion is required.",
      ],
    },
    {
      id: "req-004",
      text: "Azure AI / Azure OpenAI",
      category: "technical_skill",
      classification: "unspecified",
      origin: "technical_environment",
      technical_skills: [
        { name: "Azure AI", category: "ai_ml" },
        { name: "Azure OpenAI", category: "ai_ml" },
      ],
      evidence: evidence("Azure AI / Azure OpenAI"),
      warnings: ["An environment mention is not an explicit qualification."],
    },
  ],
  warnings: ["Some requirement classifications need human interpretation."],
  method: "deterministic-v1",
};
