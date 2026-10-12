"""Language-extensible section aliases and accent-insensitive matching."""
import re
import unicodedata

def normalized(value: str) -> str:
    value = ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c))
    return re.sub(r'[^\w+#.]+', ' ', value).strip()

ALIASES = {
    'education': ['education', 'academic background', 'formation', 'formations', 'études', 'parcours académique'],
    'experience': ['experience', 'experiences', 'work experience', 'professional experience', 'expériences professionnelles', 'expérience professionnelle', 'parcours professionnel'],
    'skills': ['skills', 'technical skills', 'technologies', 'compétences techniques', 'compétences informatiques', 'compétences'],
    'projects': ['projects', 'personal projects', 'selected projects', 'projets', 'projets sélectionnés', 'réalisations'],
    'languages': ['languages', 'spoken languages', 'langues'],
    'certifications': ['certifications', 'certificates', 'certificats'],
    'other': ['summary', 'profile', 'professional summary', 'profil', 'à propos', 'résumé professionnel', 'interests', 'references', "centres d’intérêt"],
    'contact': ['contact', 'contact information', 'personal information', 'coordonnées', 'informations personnelles'],
}
SECTION_ALIASES = {normalized(alias): section for section, aliases in ALIASES.items() for alias in aliases}

def section_heading(line: str, current: str = 'contact') -> tuple[str | None, str]:
    heading, separator, inline = line.partition(':')
    key = SECTION_ALIASES.get(normalized(heading))
    if normalized(heading) == 'technologies' and current in {'experience', 'projects'} and inline.strip():
        return None, ''
    # Matching is exact after normalization, never a prefix inside a sentence.
    return key, inline.strip() if separator else ''
