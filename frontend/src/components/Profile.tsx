import {
  BriefcaseBusiness,
  GraduationCap,
  Code2,
  FolderGit2,
  Languages,
  Award,
  Mail,
  Phone,
  ExternalLink,
  UserRound,
  MapPin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { CVParsingResponse } from "../types";
import { ExtractionWarnings } from "./ExtractionWarnings";

function Section({
  title,
  icon: Icon,
  count,
  children,
  order,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  children: ReactNode;
  order: number;
}) {
  return (
    <section className="card profile-section" style={{ order }}>
      <h3>
        <Icon size={18} />
        {title}
        <span className="count">{count}</span>
      </h3>
      {count ? (
        children
      ) : (
        <p className="empty-field">Not extracted from this document.</p>
      )}
    </section>
  );
}
function Tags({ values }: { values: string[] }) {
  return (
    <div className="tags">
      {values.map((value, index) => (
        <span className="tag" key={`${value}-${index}`}>
          {value}
        </span>
      ))}
    </div>
  );
}
function SafeLink({
  url,
  children,
}: {
  url: string | null;
  children: ReactNode;
}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="profile-link">
      {children}
      <ExternalLink size={13} />
    </a>
  );
}
function Dates({ start, end }: { start: string | null; end: string | null }) {
  return start || end ? (
    <p className="record-date">
      {start ?? "Unknown start"} – {end ?? "Unknown end"}
    </p>
  ) : null;
}
export function Profile({
  result,
  reviewed = false,
}: {
  result: CVParsingResponse;
  reviewed?: boolean;
}) {
  const { candidate: c, parsing_metadata: metadata } = result;
  return (
    <div className="profile-result">
      <section className="card candidate-heading">
        <div className="avatar">
          <UserRound size={28} />
        </div>
        <div>
          <span className="eyebrow">
            {reviewed ? "REVIEWED PROFILE" : "EXTRACTED PROFILE"}
          </span>
          <h2>{c.full_name ?? "Name not extracted"}</h2>
          <div className="contact-details">
            <span>
              <Mail size={14} />
              {c.email ?? "Email not extracted"}
            </span>
            <span>
              <Phone size={14} />
              {c.phone ?? "Phone not extracted"}
            </span>
            <SafeLink url={c.linkedin_url}>LinkedIn</SafeLink>
            <SafeLink url={c.github_url}>GitHub</SafeLink>
          </div>
        </div>
        <span className="badge amber">Partial extraction</span>
      </section>
      <ExtractionWarnings metadata={metadata} />
      <div className="profile-grid">
        <div className="profile-column">
          <Section
            order={1}
            title="Work experience"
            icon={BriefcaseBusiness}
            count={c.experience.length}
          >
            {c.experience.map((item, i) => (
              <article className="record" key={i}>
                <h4>{item.job_title ?? "Role not extracted"}</h4>
                <p>{item.company ?? "Company not extracted"}</p>
                {item.location && (
                  <p className="record-location">
                    <MapPin size={12} />
                    {item.location}
                  </p>
                )}
                <Dates start={item.start_date} end={item.end_date} />
                {item.description && (
                  <p className="record-description">{item.description}</p>
                )}
                <Tags values={item.technologies} />
              </article>
            ))}
          </Section>
          <Section
            order={4}
            title="Projects"
            icon={FolderGit2}
            count={c.projects.length}
          >
            {c.projects.map((item, i) => (
              <article className="record" key={i}>
                <h4>{item.name ?? "Project name not extracted"}</h4>
                {item.description && (
                  <p className="record-description">{item.description}</p>
                )}
                <Tags values={item.technologies} />
                <SafeLink url={item.github_url}>View repository</SafeLink>
              </article>
            ))}
          </Section>
        </div>
        <div className="profile-column">
          <Section
            order={2}
            title="Education"
            icon={GraduationCap}
            count={c.education.length}
          >
            {c.education.map((item, i) => (
              <article className="record" key={i}>
                <h4>{item.degree ?? "Degree not extracted"}</h4>
                <p>{item.institution ?? "Institution not extracted"}</p>
                {item.field_of_study && <p>{item.field_of_study}</p>}
                <Dates start={item.start_date} end={item.end_date} />
              </article>
            ))}
          </Section>
          <Section
            order={3}
            title="Technical skills"
            icon={Code2}
            count={c.technical_skills.length}
          >
            <div className="skill-groups">
              {[
                ...new Set(c.technical_skills.map((skill) => skill.category)),
              ].map((category) => (
                <div key={category}>
                  <h4 className="skill-label">
                    {category.replaceAll("_", " ")}
                  </h4>
                  <Tags
                    values={c.technical_skills
                      .filter((skill) => skill.category === category)
                      .map((skill) => skill.name)}
                  />
                </div>
              ))}
            </div>
          </Section>
          <Section
            order={5}
            title="Languages"
            icon={Languages}
            count={c.languages.length}
          >
            {c.languages.map((item, i) => (
              <div className="simple-record" key={i}>
                <strong>{item.name}</strong>
                <span>{item.proficiency ?? "Proficiency not extracted"}</span>
              </div>
            ))}
          </Section>
          <Section
            order={6}
            title="Certifications"
            icon={Award}
            count={c.certifications.length}
          >
            {c.certifications.map((item, i) => (
              <article className="record" key={i}>
                <h4>{item.name}</h4>
                <p>{item.issuer ?? "Issuer not extracted"}</p>
                {item.date && <p className="record-date">{item.date}</p>}
              </article>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}
