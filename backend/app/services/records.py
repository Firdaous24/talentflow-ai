"""Entry-local segmentation and conservative title / employer / date association."""
import re
from app.models.candidate import Education, WorkExperience, Project
from app.services.sections import normalized

LABELS = {
    'experience': {'job title': 'job_title', 'poste': 'job_title', 'company': 'company', 'entreprise': 'company', 'organisation': 'company', 'organization': 'company', 'location': 'location', 'lieu': 'location', 'localisation': 'location'},
    'education': {'degree': 'degree', 'diplome': 'degree', 'institution': 'institution', 'etablissement': 'institution', 'field of study': 'field_of_study', 'specialite': 'field_of_study'},
    'projects': {'project': 'name', 'projet': 'name', 'name': 'name', 'nom': 'name', 'github': 'github_url'},
}
COMMON = {'start date': 'start_date', 'debut': 'start_date', 'end date': 'end_date', 'fin': 'end_date', 'description': 'description', 'responsibilities': 'description', 'missions': 'description', 'technologies': 'technologies'}
COUNTRIES = {'maroc', 'morocco', 'france', 'canada', 'tunisie', 'tunisia', 'algerie', 'algeria', 'belgique', 'belgium', 'allemagne', 'germany', 'espagne', 'spain', 'royaume uni', 'united kingdom', 'united states', 'etats unis'}
PROSE_START = re.compile(r'^(?:built|developed|created|designed|tested|implemented|worked|generated|conception|developpement|développement|création|creation|réalisation|realisation|implemented|this|it |ce |cette |les |le |la |an |a |un |une )\b', re.I)

def clean(text):
    return re.sub(r'^\s*[-*•·]\s+', '', text).strip()

def label_value(text, kind):
    label, separator, value = clean(text).partition(':')
    return ({**COMMON, **LABELS[kind]}.get(normalized(label)), value.strip()) if separator else (None, '')

def project_title(text):
    if re.match(r'^https?://', clean(text), re.I):
        return None, None
    title, separator, description = clean(text).partition(':')
    reserved = set(COMMON) | set(LABELS['projects']) | {'url', 'link', 'lien', 'results', 'resultats', 'objective', 'objectif', 'note'}
    valid = separator and description.strip() and normalized(title) not in reserved and short_title(title)
    return (title.strip(), description.strip()) if valid else (None, None)

def short_title(text):
    text = clean(text)
    return bool(text and text[0].isupper() and len(text) <= 180 and len(text.split()) <= 16 and not text.endswith(('.', ';')) and not PROSE_START.match(text) and not re.search(r'https?://|[!?]|\.\s+\S', text, re.I))

def is_location(text):
    # Country mentions or explicit location labels are evidence; an arbitrary
    # standalone city is not guessed from capitalization.
    return normalized(text) in COUNTRIES or any(normalized(part.strip()) in COUNTRIES for part in text.split(','))

def wrapped_title(first, following):
    if not first or not following or not first.spans or not following.spans:
        return False
    first_size = max(span.size for span in first.spans)
    next_size = max(span.size for span in following.spans)
    return (all(any(span.flags & 16 for span in line.spans) for line in (first, following))
            and abs(next_size - first_size) < .5
            and abs(first.bbox[0] - following.bbox[0]) < 5
            and first.id.split('-l')[0] == following.id.split('-l')[0]
            and first_size * .7 <= following.bbox[1] - first.bbox[1] <= first_size * 1.6)

def parse_records(lines, kind, warnings, document=None, bindings=None):
    from app.services.extraction import extract_skills, validated_fields
    from app.services.multilingual import ROLE, DEGREE, INSTITUTION, date_range, date_value, section_sources
    sources = section_sources(document).get(kind, []) if document else []
    cursor = 0
    tokens = []
    for text in lines:
        source = None
        if text:
            for i in range(cursor, len(sources)):
                if clean(sources[i].text) == clean(text):
                    source = sources[i]; cursor = i + 1; break
        tokens.append((text, source))

    def anchor(text, source=None):
        key, _ = label_value(text, kind)
        if key == {'experience': 'job_title', 'education': 'degree', 'projects': 'name'}[kind]:
            return True
        original_text = text
        text = clean(text)
        bullet = bool(re.match(r'^\s*[-*•·]\s+', source.text if source else original_text))
        if kind == 'experience': return bool(ROLE.match(text)) and not (bullet and not (source and any(span.flags & 16 for span in source.spans)))
        if kind == 'education': return bool(DEGREE.match(text))
        if project_title(text)[0]: return True
        bold = source and any(span.flags & 16 for span in source.spans)
        bullet = bool(re.match(r'^\s*[-*•·]\s+', text if not source else source.text))
        return bool(short_title(text) and (bold or bullet))

    groups, group = [], []
    for index, (text, source) in enumerate(tokens):
        if not text:
            # Blank space inside an entry is not a record boundary by itself.
            # A plain project title after a blank remains supported.
            next_text = next((v for v, _ in tokens[index + 1:] if v), '')
            if kind == 'projects' and group and short_title(next_text):
                groups.append(group); group = []
            continue
        start, _, _ = date_range(text)
        next_token = tokens[index + 1] if index + 1 < len(tokens) else ('', None)
        leading_date = start and group and any(date_range(v)[0] for v, _ in group) and anchor(*next_token)
        school_first = kind == 'education' and INSTITUTION.search(text) and group and any(DEGREE.match(clean(v)) for v, _ in group) and any(INSTITUTION.search(v) for v, _ in group) and anchor(*next_token)
        has_anchor = any(anchor(v, s) for v, s in group) or (kind == 'projects' and len(group) > 1 and short_title(group[0][0]))
        valid_prefix = all(date_range(v)[0] or (kind == 'education' and INSTITUTION.search(v)) for v, _ in group)
        if group and ((anchor(text, source) and (has_anchor or not valid_prefix)) or leading_date or school_first):
            # A bold wrapped role continuation is handled below; only real role
            # or degree anchors (or supported project titles) start new entries.
            groups.append(group); group = []
        group.append((text, source))
    if group: groups.append(group)

    records = []
    model = {'education': Education, 'experience': WorkExperience, 'projects': Project}[kind]
    for group in groups:
        fields, content, ranges = {}, [], []
        for raw, source in group:
            key, value = label_value(raw, kind)
            if key and value:
                if key in fields:
                    warnings.append(f'Ambiguous {kind}.{key}; later value omitted.'); continue
                fields[key] = [s.name for s in extract_skills(value, include_github=True)] if key == 'technologies' else (date_value(value) or value) if key in {'start_date', 'end_date'} else value
                continue
            responsibility = bool(re.match(r'^\s*[-*•·]\s+', raw)) or bool(PROSE_START.match(clean(raw)))
            month_prefix = re.match(r'^([A-Za-zÀ-ÿ]+\.?\s*\d{4})\s*[-–—]', clean(raw))
            if kind != 'projects' and not responsibility and month_prefix and date_value(month_prefix[1]) is None:
                warnings.append(f'Unrecognized {kind} month expression omitted; review the source.')
                continue
            start, end, rest = (None, None, raw) if kind == 'projects' or responsibility else date_range(raw)
            if kind != 'projects' and not responsibility and not start and re.search(r'\b\d{4}\b\s*[-–—]\s*(?:\w+\.?\s*)?\d{4}\b|\b\w+\.\s*\d{4}\s*[-–—]', raw):
                warnings.append(f'Unrecognized {kind} date expression omitted; review the source.')
                continue
            if start:
                ranges.append((start, end))
            if rest:
                content.append((rest.strip(), source))
        if len(set(ranges)) == 1:
            fields.setdefault('start_date', ranges[0][0]); fields.setdefault('end_date', ranges[0][1])
        elif ranges:
            warnings.append(f'Ambiguous {kind} date ranges; automatic dates omitted.')
        title_key = {'experience': 'job_title', 'education': 'degree', 'projects': 'name'}[kind]
        title_source = None
        title = fields.get(title_key)
        if not title and content:
            first, title_source = content.pop(0)
            if kind == 'education' and INSTITUTION.search(first) and content and DEGREE.match(clean(content[0][0])):
                fields.setdefault('institution', first); first, title_source = content.pop(0)
            if kind == 'projects':
                inline_name, inline_description = project_title(first)
                if inline_name:
                    title = inline_name; content.insert(0, (inline_description, title_source))
                elif short_title(first) and content:
                    title = clean(first)
            elif (ROLE if kind == 'experience' else DEGREE).match(clean(first)) and not clean(first).endswith('.'):
                title = clean(first)
        if not title:
            continue

        if kind == 'experience':
            # Dash-separated subtitles remain part of the role. Only explicit
            # employer separators establish an inline company.
            parts = re.split(r'\s+(?:\||chez|at)\s+', title, maxsplit=1)
            fields['job_title'] = parts[0]
            if len(parts) == 2: fields.setdefault('company', parts[1])
            metadata, responsibilities = [], []
            for text, source in content:
                if is_location(clean(text)) and not responsibilities:
                    if 'location' not in fields: fields['location'] = clean(text)
                    elif fields['location'] != clean(text):
                        fields['location'] = None; warnings.append('Ambiguous experience location; review required.')
                    continue
                bullet = bool(re.match(r'^\s*[-*•·]\s+', text))
                if not responsibilities and not bullet and not text.endswith('.') and not PROSE_START.match(clean(text)) and len(text.split()) <= 12:
                    bold_continuation = wrapped_title(title_source, source) and not fields.get('company')
                    if bold_continuation:
                        fields['job_title'] += ' ' + clean(text)
                        title_source = source
                    else: metadata.append(clean(text))
                else: responsibilities.append(text)
            if not fields.get('company') and len(metadata) == 1:
                fields['company'] = metadata[0]
            elif metadata:
                warnings.append('Uncertain experience employer metadata omitted; review the source entry.')
            if responsibilities:
                fields['description'] = '\n'.join(responsibilities)
        elif kind == 'education':
            while content and wrapped_title(title_source, content[0][1]) and not INSTITUTION.search(content[0][0]) and not DEGREE.match(clean(content[0][0])):
                continuation, title_source = content.pop(0)
                title += ' ' + clean(continuation)
            # A dash specialization is not an institution. Preserve the whole
            # degree unless the suffix is clearly an institution.
            separators = list(re.finditer(r'\s+(?:\||[–—-])\s+', title))
            parts = re.split(r'\s+(?:\||[–—-])\s+', title)
            if len(parts) > 1 and INSTITUTION.search(parts[-1]):
                fields['degree'] = title[:separators[-1].start()].strip()
                fields.setdefault('institution', parts[-1])
            else: fields['degree'] = title
            for text, _ in content:
                if INSTITUTION.search(text):
                    if 'institution' not in fields: fields['institution'] = clean(text)
                    elif fields['institution'] != clean(text): warnings.append('Ambiguous education institution; later value omitted.')
            study = re.search(r'\b(?:en|in)\s+(.+)', fields['degree'], re.I)
            if study: fields.setdefault('field_of_study', study[1])
            elif len(parts) > 1 and not INSTITUTION.search(parts[1]) and not re.match(r'^(?:mention|honou?rs?|distinction)\b', parts[1], re.I): fields.setdefault('field_of_study', parts[1])
        else:
            fields['name'] = title
            urls = list(dict.fromkeys(re.findall(r'https?://(?:www\.)?github\.com/[\w./%-]+', '\n'.join(text for text, _ in group), re.I)))
            if len(urls) == 1: fields.setdefault('github_url', urls[0])
            if content: fields['description'] = '\n'.join(text for text, _ in content)

        if kind in {'experience', 'projects'}:
            # URL path tokens and employer names do not establish technologies.
            associated = [fields[title_key], fields.get('description') or '', ' '.join(fields.get('technologies') or [])]
            fields['technologies'] = [s.name for s in extract_skills('\n'.join(associated), include_github=True)]
        if fields.get('description') and len(fields['description']) > 2000:
            fields['description'] = fields['description'][:2000]
            warnings.append(f'{kind}.description exceeded 2000 characters and was truncated; review the source.')
        record = validated_fields(model, fields, warnings, kind)
        if record:
            if bindings is not None:
                bindings[f'{kind}.{len(records)}'] = [source for _, source in group if source]
            records.append(record)
            warnings.append(f'{kind.capitalize()} entry interpreted from source order; review field associations.')
    return records
