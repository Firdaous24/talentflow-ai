"""Source-preserving post headings and explicitly labeled job metadata."""

import re
import unicodedata

from app.models.job import RequirementEvidence
from app.services.job_vocabulary import norm, skills_in

METADATA_LABELS = {
    "job title": "title", "title": "title", "poste": "title", "intitule du poste": "title",
    "company": "company", "entreprise": "company",
    "location": "location", "lieu": "location", "localisation": "location",
    "employment type": "employment_type", "contract": "employment_type", "contrat": "employment_type", "type de contrat": "employment_type",
    "work mode": "work_mode", "working mode": "work_mode", "mode de travail": "work_mode", "modalite de travail": "work_mode", "modalites de travail": "work_mode",
}
METADATA_PATTERN = re.compile(r"(?<!\w)(?:job title|title|poste|intitul[eé] du poste|company|entreprise|location|lieu|localisation|employment type|contract|contrat|type de contrat|work mode|working mode|mode de travail|modalit[eé]s? de travail)\s*[:：]", re.I)
METADATA_DELIMITER = re.compile(r"\s*(?:[→⇒➜➡⟶⮕]+\ufe0f?|->|\|)\s*")
CONTACT = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+|https?://\S+|#\w+", re.I)
APPLICATION = re.compile(r"\b(?:to apply(?=\s*[,;:]|\s+(?:send|submit|visit|contact|please)\b)|apply (?:now|by|via|here|online|today|using\b.{0,50}\b(?:form|link|cv|resume))|send (?:your )?cv|send (?:your )?resume|envoyez|postulez|candidature|contactez|email|e-mail|telephone)\b", re.I)


def meaningful_clause(value: str) -> bool:
    """Check a shadow string only; source punctuation and offsets stay intact.

    Copied posts sometimes contain literal escaped line breaks, HTML spacing
    markers or decoration-only lines. A name, path or regular expression with
    actual letters/digits still has content, including C++, C# and .NET.
    """
    visible = re.sub(r"\\[nrt]|(?i:<br\s*/?>|&(?:nbsp|ensp|emsp|thinsp|#160|#xa0);?)", "", value)
    return any(character.isalnum() for character in visible)


def content_start(value: str) -> int:
    position = len(value) - len(value.lstrip())
    numbered = re.match(r"\d+\s*[.)—–-]\s*", value[position:])
    if numbered:
        position += numbered.end()
    while position < len(value):
        character = value[position]
        if character.isspace() or character in "-*•●▪◦▸►▶✓✔☑#_=" or unicodedata.category(character) in {"So", "Sk", "Cf", "Mn"}:
            position += 1
        else:
            break
    return position


def heading_key(value: str) -> str:
    value = value[content_start(value):].strip()
    while value and unicodedata.category(value[0])[0] in {"P", "S"}:
        value = value[1:].lstrip()
    while value and (value[-1].isspace() or unicodedata.category(value[-1])[0] in {"P", "S"} or unicodedata.category(value[-1]) in {"Cf", "Mn"}):
        value = value[:-1]
    return norm(value).strip()


def section_heading(line: str, headings: dict):
    # Anchor the complete heading label; a heading in ordinary prose cannot
    # change scope. Decoration is removed only around that anchored label.
    whole = headings.get(heading_key(line))
    if whole:
        return whole, None
    delimiter = re.search(r"[:：]|\s+[—–|→⇒➜➡-]\ufe0f?\s+", line)
    if delimiter:
        key = heading_key(line[:delimiter.start()])
        if key in headings:
            position = delimiter.end()
            position += len(line[position:]) - len(line[position:].lstrip())
            return headings[key], position if position < len(line) else None
    return None, None


def work_mode(value: str) -> str | None:
    cleaned = norm(value)
    hybrid = bool(re.search(r"\bhybrid(?:e)?\b", cleaned))
    remote = bool(re.search(r"\b(?:remote|teletravail|a distance|distanciel)\b", cleaned))
    onsite = bool(re.search(r"\b(?:on[ -]?site|presentiel|sur site|in[ -]?office)\b", cleaned))
    if re.search(r"\b(?:not|no|pas|non|sans)\s+(?:\w+\s+){0,2}(?:hybrid\w*|remote|teletravail|presentiel|on[ -]?site)\b|\b(?:not (?:offered|allowed|available|possible)|excluded|unavailable|prohibited|exclu\w*|interdit\w*|n['’]est pas|ne .{0,25} pas|possibly|possible\w*|potentially|could|might|peut-etre|eventuellement|envisage\w*)\b", cleaned):
        return None
    if sum((hybrid, remote, onsite)) > 1 and re.search(r"\b(?:or|ou|either|optional|optionnel\w*)\b", cleaned):
        return None
    if hybrid:
        return "Hybrid"
    if remote and onsite:
        return None
    return "Remote" if remote else "On-site" if onsite else None


def metadata_in(line: str, start: int):
    updates, evidence, warnings = {}, {}, []
    consumed = False
    pieces = []
    previous = 0
    for delimiter in [*METADATA_DELIMITER.finditer(line), None]:
        end = delimiter.start() if delimiter else len(line)
        piece = line[previous:end]
        left = content_start(piece)
        right = len(piece.rstrip())
        if right > left:
            pieces.append((piece[left:right], start + previous + left))
        if delimiter:
            previous = delimiter.end()
    for piece, offset in pieces:
        matches = list(METADATA_PATTERN.finditer(piece))
        if not matches or matches[0].start() != 0:
            continue
        consumed = True
        if CONTACT.search(piece) or APPLICATION.search(piece):
            continue
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(piece)
            left = match.end() + len(piece[match.end():end]) - len(piece[match.end():end].lstrip())
            right = end - len(piece[:end]) + len(piece[:end].rstrip())
            quote = piece[left:right].rstrip("; ")
            right = left + len(quote)
            key = METADATA_LABELS.get(norm(match[0].rstrip("：: ")).strip())
            if not quote or len(quote) > 2000 or not key:
                continue
            value = work_mode(quote) if key == "work_mode" else quote
            if key in {"location", "employment_type"} and len(quote) > 120:
                value = None
            if value is None:
                warnings.append(f"The explicit {key.replace('_', ' ')} wording is unclear; the field remains empty and needs source review.")
            quoted_evidence = RequirementEvidence(quote=quote, start=offset + left, end=offset + right)
            if key not in updates:
                updates[key] = value
                evidence[key] = [quoted_evidence]
            else:
                evidence[key].append(quoted_evidence)
                if updates[key] != value:
                    updates[key] = None
                    warnings.append(f"Conflicting {key.replace('_', ' ')} labels were found; the field remains empty and needs source review.")
    # A short unlabeled place before explicit contract/work-mode labels is a
    # common copied-post metadata pattern. It is never inferred from prose.
    if len(pieces) > 1 and "location" not in updates and any(key in updates for key in {"employment_type", "work_mode"}):
        place, offset = pieces[0]
        if not METADATA_PATTERN.search(place) and not CONTACT.search(place) and not APPLICATION.search(place) and not skills_in(place, technical_context=True) and len(place) <= 80 and re.fullmatch(r"[\wÀ-ÿ][\wÀ-ÿ /(),'-]*", place) and not re.search(r"\b(?:we|nous|you|vous|require\w*|requis\w*|must|engineer\w*|ingenieur\w*|architect\w*|developer\w*|recherche\w*|hire|hiring|looking|seeking|preferred|skills?|competences?|opportunit\w*|join|rejoignez|rejoindre|role|offre|aventure|recrute\w*|welcome|bienvenue)\b", norm(place)):
            updates["location"] = place
            evidence["location"] = [RequirementEvidence(quote=place, start=offset, end=offset + len(place))]
    return updates, evidence, warnings, consumed
