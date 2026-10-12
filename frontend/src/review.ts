import type { CandidateProfile } from "./types";

function flatten(
  value: unknown,
  prefix = "",
  result: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      flatten(item, prefix ? `${prefix}.${key}` : key, result);
  } else result[prefix] = value;
  return result;
}
export function changedFields(
  original: CandidateProfile,
  reviewed: CandidateProfile,
): string[] {
  const before = flatten(original),
    after = flatten(reviewed);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) =>
      (before[key] === "" ? null : (before[key] ?? null)) !==
      (after[key] === "" ? null : (after[key] ?? null)),
  );
}
export function validateReview(profile: CandidateProfile): string | null {
  if (
    profile.email &&
    !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(profile.email)
  )
    return "Enter a valid email address or leave it blank.";
  if (
    profile.phone &&
    (!/^\+?[\d ()\-.]+$/.test(profile.phone) ||
      profile.phone.replace(/\D/g, "").length < 7 ||
      profile.phone.replace(/\D/g, "").length > 15)
  )
    return "Phone must contain 7 to 15 digits and valid telephone punctuation.";
  for (const [key, value] of Object.entries(flatten(profile))) {
    if (
      typeof value === "string" &&
      value.length > (key === "email" ? 254 : 2000)
    )
      return "A field exceeds its maximum length.";
    if (key.endsWith("_url") && value) {
      try {
        const url = new URL(String(value));
        const domain = key.endsWith("linkedin_url")
          ? "linkedin.com"
          : "github.com";
        if (
          !["http:", "https:"].includes(url.protocol) ||
          ![domain, `www.${domain}`].includes(url.hostname) ||
          url.username ||
          url.password
        )
          return `Use a valid ${domain} profile URL.`;
      } catch {
        return "Enter a valid profile URL.";
      }
    }
    if (
      /(?:start_date|end_date|\.date)$/.test(key) &&
      value &&
      value !== "Present"
    ) {
      if (
        !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(
          String(value),
        )
      )
        return "Dates must use YYYY, YYYY-MM, YYYY-MM-DD or Present.";
      const [year, month = 1, day = 1] = String(value).split("-").map(Number);
      const date = new Date(0);
      date.setUTCFullYear(year, month - 1, day);
      if (
        year < 1 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      )
        return "Enter a valid calendar date.";
    }
  }
  if (
    [
      ...profile.technical_skills,
      ...profile.languages,
      ...profile.certifications,
    ].some((item) => !item.name.trim())
  )
    return "Skills, languages and certifications need a name. Remove empty entries or enter a name.";
  return null;
}
