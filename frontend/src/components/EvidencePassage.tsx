import type { ReactNode } from "react";

/**
 * Source passages with the exact evidence span highlighted from API offsets.
 * Offsets count Unicode code points (Python), so slicing uses Array.from.
 * The highlighted span is the only <blockquote> text: surrounding context is
 * rendered outside it, so the quotation itself is never altered.
 */

const CONTEXT_LIMIT = 140;

interface PassageParts {
  previous: string;
  before: string;
  after: string;
  next: string;
}

function clip(text: string, fromEnd: boolean) {
  const chars = Array.from(text);
  if (chars.length <= CONTEXT_LIMIT) return text;
  return fromEnd ? `…${chars.slice(-CONTEXT_LIMIT).join("")}` : `${chars.slice(0, CONTEXT_LIMIT).join("")}…`;
}

/** Context on the same line, plus the neighbouring lines, around [start, end). */
export function passageContext(source: string, start: number, end: number): PassageParts {
  const chars = Array.from(source);
  let lineStart = start;
  while (lineStart > 0 && chars[lineStart - 1] !== "\n") lineStart -= 1;
  let lineEnd = end;
  while (lineEnd < chars.length && chars[lineEnd] !== "\n") lineEnd += 1;
  let previousStart = lineStart - 1;
  while (previousStart > 0 && chars[previousStart - 1] !== "\n") previousStart -= 1;
  let nextEnd = lineEnd + 1;
  while (nextEnd < chars.length && chars[nextEnd] !== "\n") nextEnd += 1;
  return {
    previous: lineStart > 0 ? clip(chars.slice(Math.max(0, previousStart), lineStart - 1).join("").trim(), true) : "",
    before: clip(chars.slice(lineStart, start).join(""), true),
    after: clip(chars.slice(end, lineEnd).join(""), false),
    next: lineEnd < chars.length ? clip(chars.slice(lineEnd + 1, nextEnd).join("").trim(), false) : "",
  };
}

/** True when [start, end) of source is exactly the quoted text, in code points. */
export function spanMatches(source: string, start: number, end: number, quote: string) {
  const chars = Array.from(source);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= chars.length && chars.slice(start, end).join("") === quote;
}

export function OffsetBadge({ start, end }: { start?: number; end?: number }) {
  return <span className="offset-badge" aria-hidden="true">{start === undefined || end === undefined ? "whole field" : `chars ${start}–${end}`}</span>;
}

/** A passage: dimmed neighbouring lines, then the line with its exact span highlighted. */
export function Passage({ parts, children }: { parts?: PassageParts; children: ReactNode }) {
  return (
    <div className="evidence-passage">
      {parts?.previous && <p className="evidence-context">{parts.previous}</p>}
      <div className="evidence-line">
        {parts?.before && <span className="evidence-context">{parts.before}</span>}
        {children}
        {parts?.after && <span className="evidence-context">{parts.after}</span>}
      </div>
      {parts?.next && <p className="evidence-context">{parts.next}</p>}
    </div>
  );
}

/** One job-post evidence span, shown inside its source line. Falls back to the quote alone if offsets do not match. */
export function JobPassage({ quote, start, end, source, label }: { quote: string; start: number; end: number; source: string; label: string }) {
  const exact = spanMatches(source, start, end, quote);
  return (
    <figure className="evidence-doc job">
      <figcaption className="evidence-doc-head"><span>{label}</span><OffsetBadge start={start} end={end} /></figcaption>
      <Passage parts={exact ? passageContext(source, start, end) : undefined}>
        <blockquote className="evidence-hit">
          {quote}
          <small className="visually-hidden">
            Source characters {start}–{end}
          </small>
        </blockquote>
      </Passage>
    </figure>
  );
}
