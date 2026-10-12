"""Conservative unlabeled header/entry rules and auditable source references."""
import re
from app.models.candidate import Education, WorkExperience, Project, FieldEvidence
from app.services.sections import normalized, section_heading

MONTHS = {'janvier': 1, 'january': 1, 'jan': 1, 'février': 2, 'fevrier': 2, 'february': 2, 'feb': 2, 'mars': 3, 'march': 3, 'avril': 4, 'april': 4, 'avr': 4, 'mai': 5, 'may': 5, 'juin': 6, 'june': 6, 'juillet': 7, 'july': 7, 'août': 8, 'aout': 8, 'august': 8, 'septembre': 9, 'september': 9, 'sept': 9, 'octobre': 10, 'october': 10, 'oct': 10, 'novembre': 11, 'november': 11, 'nov': 11, 'décembre': 12, 'decembre': 12, 'december': 12, 'dec': 12}
MONTHS.update({'janv': 1, 'fév': 2, 'févr': 2, 'fev': 2, 'fevr': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'juil': 7, 'aug': 8, 'sep': 9, 'déc': 12})
DATE_RE = re.compile(r'\b(?:' + '|'.join(MONTHS) + r')\.?\s*\d{4}\b|\b\d{4}(?:-\d{2}(?:-\d{2})?)?\b|\b(?:present|présent|aujourd[’\x27]hui|actuellement|en cours|current)\b', re.I)
ROLE = re.compile(r'^(?:senior\s+|junior\s+|lead\s+)?(?:ingénieure?|ingenieure?|engineer|software\s+(?:engineer|developer|architect)|data\s+(?:analyst|scientist|engineer)|analyste|développeur|développeuse|developpeur|developer|backend|frontend|full.?stack|stagiaire|stage|intern|consultant|chef de projet)\b', re.I)
DEGREE = re.compile(r'^(?:dipl[oô]me|master|mastère|msc|bsc|bachelor|licence|doctorat|phd|d[ée]g[ré]e|baccalaur[ée]at|dut|bts|ing[ée]nieur|cycle\s+pr[ée]paratoire(?:\s+int[ée]gr[ée])?|integrated\s+preparatory\s+cycle|foundation\s+(?:year|programme|program))', re.I)
INSTITUTION = re.compile(r'\b(?:universit[ée]|university|[ée]cole|school|college|institut(?:e)?|academy|facult[ée]|lyc[ée]e|insa|ens[a-z]*|polytechnique)\b', re.I)

def date_value(value: str) -> str | None:
    value = value.strip()
    if normalized(value) in {'present', 'aujourd hui', 'actuellement', 'en cours', 'current'}:
        return 'Present'
    if re.fullmatch(r'\d{4}(?:-\d{2}(?:-\d{2})?)?', value):
        return value
    match = re.fullmatch(r'([\wÀ-ÿ]+)\.?\s*(\d{4})', value)
    if match and normalized(match[1]) in {normalized(k) for k in MONTHS}:
        month = next(v for k, v in MONTHS.items() if normalized(k) == normalized(match[1]))
        return f'{match[2]}-{month:02}'
    return None

def date_range(line: str) -> tuple[str | None, str | None, str]:
    matches = list(DATE_RE.finditer(line))
    if len(matches) != 2 or not re.fullmatch(r'\s*(?:[-–—/]|à|au|to)\s*', line[matches[0].end():matches[1].start()], re.I):
        return None, None, line
    start, end = (date_value(v.group()) for v in matches)
    rest = (line[:matches[0].start()] + line[matches[1].end():]).strip(' |–—-,:()')
    return start, end, rest

def header_name(lines: list[str], document) -> str | None:
    nonempty = [line for line in lines if line and not line.startswith('[[')]
    if not nonempty:
        return None
    # Only first contact/header line, never arbitrary names in experience prose.
    first = nonempty[0].strip()
    if ':' in first or ROLE.match(first) or DEGREE.match(first) or INSTITUTION.search(first) or section_heading(first)[0] or re.search(r'\b(?:CV|resume|curriculum|inc|company|ltd|university)\b', first, re.I):
        return None
    words = first.split()
    if not 2 <= len(words) <= 5 or len(first) > 100 or not all(re.fullmatch(r'[A-ZÀ-Þ][a-zA-ZÀ-ÿ’\x27-]*', w) for w in words):
        return None
    if document.lines:
        candidates = [v for v in document.lines if v.page == 1 and v.region == 0 and v.bbox[1] < 160]
        source = next((v for v in candidates if v.text == first), None)
        if source is None or max(s.size for s in source.spans) < max((s.size for v in candidates for s in v.spans), default=0):
            return None
    return first

def natural_records(lines, kind, warnings, document=None, bindings=None):
    from app.services.records import parse_records
    return parse_records(lines, kind, warnings, document, bindings)


def section_sources(document):
    from app.services.layout import LayoutLine
    if document is None:
        return {}
    lines = document.lines or tuple(LayoutLine(f'text-{i}', text, 1, (0, 0, 0, 0), ()) for i, text in enumerate(document.text.splitlines()) if text)
    result, scope, previous = {}, 'contact', None
    for line in lines:
        region = (line.page, line.region)
        if line.text == '[[REGION]]' or (previous is not None and region != previous and line.region != 0):
            scope = 'contact'
        key, inline = section_heading(line.text, scope)
        if key:
            scope = key
            if not inline:
                previous = region
                continue
        result.setdefault(scope, []).append(line)
        previous = region
    return result


def leaves(value, prefix=''):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from leaves(item, f'{prefix}.{key}' if prefix else key)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            yield from leaves(item, f'{prefix}.{i}')
    elif value is not None and value != '' and not prefix.endswith('.category'):
        yield prefix, str(value)

def supports(value: str, quote: str) -> bool:
    norm = normalized(value.rstrip('/'))
    if norm and norm in normalized(quote):
        return True
    return any(date_value(match.group()) == value for match in DATE_RE.finditer(quote))

def evidence_for(candidate, document, bindings=None):
    sections = section_sources(document)
    bindings = bindings or {}
    result = []
    for field, value in leaves(candidate.model_dump(mode='json')):
        root = field.split('.')[0]
        target = {'technical_skills': 'skills', 'full_name': 'contact', 'email': 'contact', 'phone': 'contact', 'linkedin_url': 'contact', 'github_url': 'contact'}.get(root, root)
        entry = '.'.join(field.split('.')[:2])
        pool = bindings.get(entry, sections.get(target, []))
        if field.endswith(('.job_title', '.degree')):
            # Dates are visual row annotations, not words inside wrapped titles.
            pool = [line for line in pool if not (date_range(line.text)[0] and not date_range(line.text)[2])]
        matches = [line for line in pool if supports(value, line.text)]
        if not matches and (root == 'technical_skills' or '.technologies.' in field):
            from app.services.extraction import extract_skills
            matches = [line for line in pool if value in [s.name for s in extract_skills(line.text, include_github=True)]]
        if not matches:
            # Wrapped values must be supported by contiguous source lines of
            # this entry, never by unrelated matches elsewhere in the section.
            for length in range(2, min(len(pool), 12) + 1):
                for start in range(len(pool) - length + 1):
                    end = start + length
                    if supports(value, '\n'.join(v.text for v in pool[start:end])):
                        matches = pool[start:end]
                        break
                if matches: break
        if entry not in bindings and root in {'experience', 'education', 'projects'} and len(matches) > 1:
            matches = []
        for line in matches if len(matches) > 1 and not any(supports(value, v.text) for v in matches) else matches[:1]:
            method = 'dictionary' if root == 'technical_skills' or '.technologies.' in field else 'labeled' if ':' in line.text else 'header' if field == 'full_name' else 'layout'
            result.append(FieldEvidence(field=field, quote=line.text[:2000], source_id=line.id, page=line.page, bbox=line.bbox if line.spans else None, method=method, uncertain=method in {'layout', 'header'}))
    return result
