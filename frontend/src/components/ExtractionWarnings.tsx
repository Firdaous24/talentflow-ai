import { useId, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { CVParsingResponse } from "../types";

export function warningGroups(warnings: string[]) {
  const unique = new Map<string, string>();
  for (const warning of warnings) {
    const key = warning
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.!]+$/, "")
      .toLocaleLowerCase();
    if (key) unique.set(key, unique.get(key) ?? warning.trim());
  }
  const groups: Record<string, string[]> = {};
  for (const warning of unique.values()) {
    const category =
      /invalid|ambiguous|uncertain|unavailable|rejected|exceeded|truncated|rotated|encrypted|corrupt|unrecognized.*(?:date|month)/i.test(
        warning,
      )
        ? "Needs attention"
        : /could not|missing|incomplete.*entry/i.test(warning)
          ? "Missing information"
          : /dictionary|proficiency|skills/i.test(warning)
            ? "Skill limitations"
            : "Extraction notes";
    (groups[category] ??= []).push(warning);
  }
  return groups;
}

export function ExtractionWarnings({
  metadata,
}: {
  metadata: CVParsingResponse["parsing_metadata"];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const groups = warningGroups(metadata.warnings);
  const count = Object.values(groups).reduce(
    (total, notes) => total + notes.length,
    0,
  );
  const important = groups["Needs attention"] ?? [];
  return (
    <section
      className="notice warning extraction-warnings"
      aria-label="Extraction warnings"
    >
      <AlertTriangle size={20} />
      <div className="warnings-content">
        <strong>Review before using this profile</strong>
        <p>
          {metadata.page_count} {metadata.page_count === 1 ? "page" : "pages"}{" "}
          processed ·{" "}
          {metadata.engine === "llm"
            ? "Model-assisted extraction"
            : "Local deterministic extraction"}{" "}
          · Results may be incomplete.
        </p>
        <p>
          {count} {count === 1 ? "review note" : "review notes"}
          {important.length ? ` · ${important.length} needing attention` : ""}.
          Warnings describe the original extraction; corrections stay separate.
        </p>
        {!expanded && important.length > 0 && (
          <ul className="important-warnings">
            {important.slice(0, 2).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {count > 0 && (
          <>
            <button
              type="button"
              className="text-button warnings-toggle"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide warnings" : "Show all warnings"}
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            <div id={id} hidden={!expanded}>
              {Object.entries(groups).map(([category, notes]) => (
                <div className="warning-group" key={category}>
                  <h4>{category}</h4>
                  <ul>
                    {notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
