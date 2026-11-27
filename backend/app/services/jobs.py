"""Conservative bilingual requirements and an evidence checklist, without selection logic."""

import re
from collections.abc import Callable
from typing import Protocol

from app.models.job import (
    CandidateEvidenceExcerpt,
    CandidateRequirementEvidence,
    JobAnalysisResponse,
    JobAnalyzeRequest,
    JobComparisonRequest,
    JobComparisonResponse,
    JobDescription,
    JobRequirement,
    JobSkill,
    RequirementComparison,
    RequirementEvidence,
    TechnicalEvidence,
    TechnicalJobReference,
)
from app.services.job_formatting import (
    APPLICATION,
    CONTACT,
    content_start,
    meaningful_clause,
    metadata_in,
    section_heading,
)
from app.services.job_vocabulary import norm, normalized_label_words, skills_in


class JobWorkflowError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


class JobAnalyzer(Protocol):
    def analyze(self, text: str) -> JobAnalysisResponse: ...


# Headings alone can establish a section; only mandatory/desirable headings
# establish classification. A generic profile/qualification heading does not.
HEADINGS = {
    "job description": ("description", "unspecified"), "description du poste": ("description", "unspecified"),
    "responsibilities": ("responsibilities", "unspecified"), "responsabilites": ("responsibilities", "unspecified"), "missions": ("responsibilities", "unspecified"),
    "requirements": ("requirements", "unspecified"), "profil recherche": ("requirements", "unspecified"), "qualifications": ("requirements", "unspecified"),
    "candidate qualifications": ("requirements", "unspecified"), "qualifications du candidat": ("requirements", "unspecified"),
    "required skills": ("requirements", "required"), "required qualifications": ("requirements", "required"), "competences requises": ("requirements", "required"), "criteres obligatoires": ("requirements", "required"), "must have": ("requirements", "required"),
    "preferred qualifications": ("requirements", "preferred"), "preferred skills": ("requirements", "preferred"), "competences souhaitees": ("requirements", "preferred"), "nice to have": ("requirements", "preferred"), "desired skills": ("requirements", "preferred"), "atouts": ("requirements", "preferred"),
    "competences techniques": ("requirements", "unspecified"), "competences recherchees": ("requirements", "unspecified"), "votre profil": ("requirements", "unspecified"),
    "prerequis": ("requirements", "required"), "exigences": ("requirements", "unspecified"), "competences obligatoires": ("requirements", "required"),
    "must-have": ("requirements", "required"), "nice-to-have": ("requirements", "preferred"), "desired qualifications": ("requirements", "preferred"),
    "environnement technique": ("technical_environment", "unspecified"), "stack technique": ("technical_environment", "unspecified"),
    "technologies": ("technical_environment", "unspecified"), "technologies utilisees": ("technical_environment", "unspecified"), "outils et technologies": ("technical_environment", "unspecified"),
    "technical environment": ("technical_environment", "unspecified"), "technology stack": ("technical_environment", "unspecified"), "tech stack": ("technical_environment", "unspecified"), "tools and technologies": ("technical_environment", "unspecified"),
    "experience": ("experience", "unspecified"), "education": ("education", "unspecified"), "formation": ("education", "unspecified"),
    "certifications": ("certification", "unspecified"), "languages": ("language", "unspecified"), "langues": ("language", "unspecified"),
    "about us": ("company", "unspecified"), "about the company": ("company", "unspecified"), "company": ("company", "unspecified"), "a propos": ("company", "unspecified"), "a propos de nous": ("company", "unspecified"), "notre entreprise": ("company", "unspecified"),
    "benefits": ("irrelevant", "unspecified"), "avantages": ("irrelevant", "unspecified"), "equal opportunity": ("irrelevant", "unspecified"),
    "apply": ("irrelevant", "unspecified"), "how to apply": ("irrelevant", "unspecified"), "postuler": ("irrelevant", "unspecified"), "pour postuler": ("irrelevant", "unspecified"), "candidature": ("irrelevant", "unspecified"), "contact": ("irrelevant", "unspecified"),
}
REQUIRED = re.compile(r"\b(?:required|mandatory|must(?: have| know| be)?|essential|obligatoire|obligatoires|requis|requise|requises|exige|exigee|exigees|indispensable|indispensables|imperatif|imperative|vous devez)\b")
PREFERRED = re.compile(r"\b(?:preferred|desirable|desired|nice to have|a plus|bonus|optional|ideally|souhaite|souhaitee|souhaitees|atout|apprecie|appreciee|un plus|idealement|facultatif|facultative)\b")
# Duration is mandatory only when an explicit lower bound describes candidate
# experience in a qualification/experience section. Product retention, contract
# lengths and environment-history statements cannot establish such a criterion.
MINIMUM_DURATION = re.compile(r"\b(?:(?:minimum|au moins|at least|a minimum of)\s+\d+(?:[.,]\d+)?\s+(?:ans?|annees?|years?)|\d+(?:[.,]\d+)?\s+(?:ans?|annees?|years?)\s+minimum)\b")
QUOTED_WORDING = re.compile(r'''"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|(?<!\w)'(?=\S).*?(?<!\s)'(?!\w)''')
CONDITIONAL_REQUIREMENT = re.compile(r"\b(?:if|si|would|serait|seraient|selon|depending|sous reserve|may (?:be|require|need|have|request)|le cas echeant)\b")
QUALIFIER = re.compile(r"\b(?:experience|knowledge|proficiency|familiarity|qualified|qualification|degree|bachelor|master|certification|competence|connaissance|maitrise|diplome|formation|licence|bac\s*\+\s*\d|anglais|english|francais|french)\b")
CAPABILITY = re.compile(r"\b(?:knowledge|proficiency|familiarity|mastery|connaissance|maitrise|capacite|capability|capabilities)\b")
HYPOTHETICAL_JOB = re.compile(r"\b(?:might|could|may (?:adopt|introduce|eventually)|considering|future plans?|envisageons|envisage|envisagee|eventuellement|pourrions|pourrait|futur(?:e)? prototype)\b")
PROTECTED = re.compile(r"\b(?:age|aged|young|youthful|jeune|jeunes|ans d['’]age|gender|sex|sexe|male|female|homme|femme|men|women|nationality|nationalite|citizenship|citizen|citoyen|citoyenne|ethnic|ethnicity|ethnique|race|racial|religion|religious|religieux|muslim|musulman|christian|chretien|jewish|juif|marital|married|marie|single|celibataire|pregnan\w*|enceinte|family status|situation familiale|disability|disabled|handicap\w*|medical|health|sante|photograph|photo|birth|naissance|sexual|sexuel\w*|orientation sexuelle|native speaker|native english|native french|mother tongue|langue maternelle|culture fit|cultural fit|personality|personnalite|enthusiastic|enthousiaste|personable|outgoing|extrovert|extraverti|charismatic|charismatique|positive attitude|national origin|origine|address|adresse|residen\w*|habiter|habitant\w*|quartier|work permit|permis de travail|visa|work authorization)\b")
NEGATED_JOB = re.compile(r"\b(?:not (?:required|necessary|mandatory|essential|obligatory|at least|a minimum)|(?:do|does|did) not require|don['’]t require|doesn['’]t require|no (?:prior )?experience|no (?:education|degree|diploma|qualification|mandatory qualification|requirement)\b|without (?:prior )?experience|pas (?:requis\w*|obligatoire\w*|necessaire\w*|au moins|minimum)|non (?:requis\w*|obligatoire\w*)|aucun(?:e)? (?:experience|exigence|diplome|connaissance|maitrise)|sans experience|n['’]est pas|ne .{0,25} pas)\b")
NEGATED_CANDIDATE = re.compile(r"\b(?:no(?:\s+\w+){0,5}\s+(?:experience|knowledge|proficiency)|not familiar|(?:do|does|did) not (?:know|use|have)|not (?:known|proficient|skilled)|never used|want to learn|would like to learn|plan to learn|learning goal|future ambition|lacks?\s+\w+|sans (?:experience|maitrise|connaissance)|aucune experience|ne .{0,35} pas|souhaite(?:rais)? apprendre|pas de connaissance)\b")
EXPERIENCE = re.compile(r"\b(?:experience|years?|ans?|annees?)\b")
EDUCATION = re.compile(r"\b(?:education|degree|bachelor|master|msc|bsc|phd|doctorate|diplome|licence|doctorat|formation|bac\s*\+\s*\d)\b")
CERTIFICATION = re.compile(r"\b(?:certification|certificate|certified|certifie|certificat)\b")
LANGUAGES = {"English": ("english", "anglais"), "French": ("french", "francais"), "Arabic": ("arabic", "arabe"), "Spanish": ("spanish", "espagnol"), "German": ("german", "allemand")}
CONTACT_TEXT = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+|https?://\S+|\b(?:email|e-mail|phone|telephone|tel|contact|full name|nom complet|date of birth|date de naissance)\s*:", re.I)
LIMITATIONS = [
    "This checklist compares explicit documents only; it does not establish proficiency, eligibility or suitability and makes no employment recommendation.",
    "Not documented means supporting information was not found in this profile; it does not mean the person lacks the ability.",
    "All candidate evidence is unverified. Review confirmations are unverified client workflow assertions, not authenticated approvals.",
    "Only qualification fields are accepted. The service keeps no review records or candidate profiles and performs no external model calls.",
]

# Explicit bilingual concepts support citations, not mastery or equivalence.
# A workflow, dashboard or UML mention alone does not establish these tasks.
BUSINESS_CONCEPTS = {
    "requirements_gathering": re.compile(r"\b(?:requirements? gathering|gather(?:ing|ed)? (?:business )?requirements?|requirements? elicitation|recueil (?:des?|de) besoins|recueillir (?:les )?besoins|collecte (?:des?|de) besoins|analyse (?:des?|de) besoins)\b"),
    "business_needs_analysis": re.compile(r"\b(?:analyse (?:des?|de) besoins metier|business needs analysis|analy[sz](?:e|ed|ing) business needs)\b"),
    "process_modeling": re.compile(r"\b(?:process model(?:l?ing)|model(?:l?ed|l?ing)? (?:business )?processes|modelisation (?:uml )?(?:des?|de) processus|modelisation des processus)\b"),
    "uml": re.compile(r"\buml\b"),
    "functional_specifications": re.compile(r"\b(?:functional specifications?|specifications? fonctionnelles?)\b"),
    "requirements_documents": re.compile(r"\b(?:cahiers? des charges|requirements? documents?)\b"),
}
GENERIC_EXPERIENCE_WORDS = set("experience experiences required mandatory preferred optional years year minimum least similar position role professional prior previous relevant strong significant advantage sector industry must have with within into from and for the that this your candidate applicant knowledge expertise skills in of to a an or as is be at des une un dans sur du de la le les et en au aux avec pour ou son sa ses ces ce cette domaine poste similaire annees an ans professionnelle professionnel prealable obligatoire requis requise requises souhaite souhaitee souhaitable exige exigee indispensable minimum moins recents recente solide constitue significatif significative atout secteur industrie parcours postes metier maitrise cinq ten five".split())


def business_concepts(text: str) -> set[str]:
    cleaned = norm(text)
    concepts = {name for name, expression in BUSINESS_CONCEPTS.items() if expression.search(cleaned)}
    # Bare modeling in this coordinated BA methodology statement has a business
    # context. Do not expand unrelated 3D/data modeling or UML into process work.
    if {"requirements_gathering", "functional_specifications"} <= concepts and re.search(r"\bmodelisation(?=\s*(?:[,.;]|et\b|$))", cleaned):
        concepts.add("process_modeling")
    return concepts


def language_names(text: str) -> list[str]:
    cleaned = norm(text)
    return [name for name, aliases in LANGUAGES.items() if any(re.search(r"\b" + alias + r"\b", cleaned) for alias in aliases)]


def degree_names(text: str) -> set[str]:
    """Normalize grammatical variants only, without inferring degree equivalence."""
    found = re.findall(r"\b(?:master(?:s|['’]s)?|msc|bachelor(?:s|['’]s)?|bsc|phd|doctorate|licence|doctorat|bac\s*\+\s*\d)\b", norm(text))
    return {"master" if value.startswith("master") else "bachelor" if value.startswith("bachelor") else re.sub(r"\s+", "", value) for value in found}


def categories_in(text: str, skills: list[JobSkill], scope: str = "") -> set[str]:
    cleaned = norm(text)
    categories = set()
    if skills:
        categories.add("technical_skill")
    if EXPERIENCE.search(cleaned) or scope == "experience":
        categories.add("experience")
    if EDUCATION.search(cleaned) or scope == "education":
        categories.add("education")
    if CERTIFICATION.search(cleaned) or scope == "certification":
        categories.add("certification")
    if language_names(text) or scope == "language":
        categories.add("language")
    return categories or {"other"}


def assertion_wording(text: str) -> str:
    """Quoted examples remain source-visible but cannot assert a threshold."""
    return norm(QUOTED_WORDING.sub(" ", text))


def minimum_experience(text: str, scope: str) -> bool:
    if scope not in {"requirements", "experience"}:
        return False
    match = MINIMUM_DURATION.search(text)
    if not match:
        return False
    before, after = text[:match.start()], text[match.end():]
    standalone = not before.strip(" .,:;-\\") and not after.strip(" .,:;-\\")
    experience_after = re.match(r"\s*(?:(?:d['’]|de l['’]|of)\s*)?(?:(?:professional|relevant|prior|previous|similar)\s+)?experience\b", after)
    experience_before = re.search(r"\bexperience(?:\s+(?:professionnelle?|pertinente?|similaire|relevante?))?\s*[:=,-]?\s*(?:(?:de|of)\s+)?$", before)
    return standalone or bool(experience_after or experience_before)


def classify(text: str, inherited: str, scope: str = "requirements") -> tuple[str, list[str]]:
    cleaned = assertion_wording(text)
    if CONDITIONAL_REQUIREMENT.search(cleaned) or not meaningful_clause(cleaned):
        return "unspecified", ["Conditional or quoted qualification wording needs human interpretation; it does not establish an unconditional requirement."]
    required, preferred = bool(REQUIRED.search(cleaned)), bool(PREFERRED.search(cleaned))
    if QUOTED_WORDING.search(text) and not (required or preferred or minimum_experience(cleaned, scope)) and (REQUIRED.search(norm(text)) or PREFERRED.search(norm(text)) or MINIMUM_DURATION.search(norm(text))):
        return "unspecified", ["Quoted mandatory, desirable or duration wording is not an asserted candidate requirement; review the complete source context."]
    if required and preferred:
        return "unspecified", ["Both mandatory and desirable wording appears; classification needs human review."]
    if required:
        return "required", []
    if preferred:
        return "preferred", []
    if minimum_experience(cleaned, scope):
        return "preferred" if inherited == "preferred" else "required", []
    return inherited, []


def spans(text: str):
    """Retain exact Python Unicode character offsets through bullets and clauses."""
    cursor = 0
    for raw in text.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        prefix = len(line) - len(line.lstrip()) if re.match(r"\s*#\w", line) else content_start(line)
        end = len(line.rstrip())
        if end > prefix:
            yield line[prefix:end], cursor + prefix, cursor + end
        cursor += len(raw)


def clauses(line: str, start: int):
    # Semicolon/new sentences and explicit contrast clauses are independently
    # evidenced. Never split decimal versions or Node.js.
    boundaries = list(re.finditer(r";\s*|(?<=[.!?])\s+(?=[A-ZÀ-Ý])|\s+(?:but|mais)\s+", line))
    last = 0
    for boundary in [*boundaries, None]:
        end = boundary.start() if boundary else len(line)
        raw = line[last:end]
        left = len(raw) - len(raw.lstrip())
        right = len(raw.rstrip())
        if right > left:
            yield raw[left:right], start + last + left, start + last + right
        if boundary:
            last = boundary.end()


class DeterministicJobAnalyzer:
    def analyze(self, text: str) -> JobAnalysisResponse:
        JobAnalyzeRequest(text=text)
        metadata = {"title": None, "company": None, "location": None, "employment_type": None, "work_mode": None}
        metadata_evidence = {}
        ambiguous_metadata = set()
        requirements, responsibilities, warnings = [], [], []
        scope, inherited = "description", "unspecified"
        for index, (line, start, end) in enumerate(spans(text)):
            if not meaningful_clause(line):
                continue
            updates, source, metadata_notes, consumed = metadata_in(line, start)
            for key, value in updates.items():
                if key in ambiguous_metadata:
                    metadata_evidence.setdefault(key, []).extend(source[key])
                elif value is None:
                    metadata[key] = None
                    ambiguous_metadata.add(key)
                    metadata_evidence.setdefault(key, []).extend(source[key])
                elif metadata[key] is None:
                    metadata[key], metadata_evidence[key] = value, source[key]
                elif metadata[key] != value:
                    metadata[key] = None
                    ambiguous_metadata.add(key)
                    metadata_evidence.setdefault(key, []).extend(source[key])
                    note = f"Conflicting {key.replace('_', ' ')} labels were found; the field remains empty and both source statements need review."
                    if note not in warnings:
                        warnings.append(note)
            warnings.extend(note for note in metadata_notes if note not in warnings)
            if consumed:
                continue
            heading, inline_start = section_heading(line, HEADINGS)
            if heading:
                scope, inherited = heading
                if inline_start is None:
                    continue
                line, start = line[inline_start:], start + inline_start
                end = start + len(line)
            elif index == 0 and ":" not in line and len(line) < 150 and re.search(r"\b(?:developer|engineer|analyst|architect|developpeur|developpeuse|ingenieur|ingenieure|analyste|architecte)\b", norm(line)) and not re.search(r"\b(?:we|nous|our|notre|recrute|hiring|seeking|looking)\b", norm(line)):
                metadata["title"] = line
                metadata_evidence["title"] = [RequirementEvidence(quote=line, start=start, end=end)]
                continue
            if scope in {"company", "irrelevant"}:
                continue
            if CONTACT.search(line) or APPLICATION.search(line) or line.startswith("#"):
                continue
            for clause, clause_start, clause_end in clauses(line, start):
                if not meaningful_clause(clause):
                    continue
                cleaned = norm(clause)
                if PROTECTED.search(cleaned):
                    if "Irrelevant or protected personal-characteristic language was excluded from requirements and comparisons." not in warnings:
                        warnings.append("Irrelevant or protected personal-characteristic language was excluded from requirements and comparisons.")
                    continue
                if NEGATED_JOB.search(cleaned):
                    if "Explicitly non-required or negated qualification clauses were omitted; review the source for context." not in warnings:
                        warnings.append("Explicitly non-required or negated qualification clauses were omitted; review the source for context.")
                    continue
                if HYPOTHETICAL_JOB.search(cleaned):
                    note = "Hypothetical or future technology plans were omitted; they do not establish a current candidate qualification."
                    if note not in warnings:
                        warnings.append(note)
                    continue
                assertion = assertion_wording(clause)
                explicit = bool(REQUIRED.search(assertion) or PREFERRED.search(assertion) or minimum_experience(assertion, scope))
                if not explicit and re.search(r"^(?:j['’]ai\b|our (?:company|team|brochure|systems)\b|notre (?:societe|entreprise|equipe)\b|nous (?:sommes|utilisons)\b|we (?:are|use)\b)", cleaned):
                    continue
                if scope == "responsibilities" and not explicit:
                    if len(responsibilities) < 100:
                        responsibilities.append(clause[:2000])
                    continue
                if scope == "description" and not (explicit or QUALIFIER.search(cleaned) and re.search(r"\b(?:you|candidate|applicant|vous|candidat|profil|seeking|looking for|recherche)\b", cleaned)):
                    continue
                extracted_skills = skills_in(clause, technical_context=scope == "technical_environment")
                if scope == "technical_environment" and not extracted_skills:
                    note = "Some technical environment wording had no supported technology alias; review the original list for omitted information."
                    if note not in warnings:
                        warnings.append(note)
                    continue
                categories = categories_in(clause, extracted_skills, scope)
                if not explicit and categories == {"other"} and re.search(r"\b(?:j['’]ai|our|notre|nos|brochure|presentation|reunion|we|nous)\b", cleaned):
                    continue
                classification, notes = classify(clause, inherited, scope)
                candidate_qualification = bool(CAPABILITY.search(cleaned)) or explicit and (bool(QUALIFIER.search(cleaned)) or bool(re.search(r"\b(?:you|candidate\w*|applicant\w*|vous|candidat\w*|profil)\b|\bmust (?:know|have|master)\b", cleaned)))
                origin = "technical_environment" if scope == "technical_environment" and not candidate_qualification else "qualification"
                if origin == "technical_environment":
                    classification = "unspecified"
                    notes.append("This technology appears in the job's technical environment only; no mandatory or preferred candidate qualification is stated.")
                if len(clause) > 2000:
                    warnings.append("An overlong requirement clause was omitted; split it into shorter source lines before analysis.")
                    continue
                # Experience with a named technology remains an experience
                # requirement: the mention alone cannot satisfy it.
                category = next((item for item in ("certification", "education", "experience", "language", "technical_skill") if item in categories), "other")
                if len(categories) > 1:
                    notes.append("This clause combines qualification categories; split or interpret it during review.")
                if re.search(r"\b(?:or|and/or|ou|et/ou|equivalent|equivalente)\b|\b(?:strong|excellent|advanced|expert|solid|good|solide|avance|excellente?|bonne?)\b", cleaned):
                    notes.append("Alternatives or qualitative proficiency wording require human interpretation.")
                if category == "other":
                    notes.append("Explicit business-analysis statements can be cited, but mastery, scope and equivalence require human interpretation." if business_concepts(clause) else "The deterministic analyzer has no supported qualification rule for this wording.")
                if len(requirements) < 150:
                    requirements.append(JobRequirement(id=f"req-{len(requirements) + 1:03}", text=clause, category=category, classification=classification, origin=origin, technical_skills=extracted_skills, evidence=[RequirementEvidence(quote=clause, start=clause_start, end=clause_end)], warnings=notes))
                elif "Only the first 150 requirements were extracted; shorten the source before review." not in warnings:
                    warnings.append("Only the first 150 requirements were extracted; shorten the source before review.")
        if not requirements:
            warnings.append("No supported job-related technical information or explicit qualifications were detected. Review the source and add clear section headings without inventing requirements.")
        elif all(item.origin == "technical_environment" for item in requirements):
            warnings.append("Technical environment mentions were extracted, but no mandatory candidate qualifications were explicitly stated. Review them as contextual technology information.")
        warnings.extend(["Deterministic French/English extraction can omit or misinterpret wording; review every requirement and its original source.", "A mention of a skill does not establish proficiency. No education or experience duration is inferred from a job title."])
        return JobAnalysisResponse(job=JobDescription(**metadata, metadata_evidence=metadata_evidence, text=text, responsibilities=responsibilities), requirements=requirements, warnings=warnings)


def qualification_leaves(candidate):
    for section, records in candidate.model_dump().items():
        for index, record in enumerate(records):
            for key, value in record.items():
                if key == "category":
                    continue
                values = value if isinstance(value, list) else [value]
                for item_index, item in enumerate(values):
                    if item and not PROTECTED.search(norm(item)) and not NEGATED_CANDIDATE.search(norm(item)) and not CONTACT_TEXT.search(item):
                        field = f"{section}.{index}.{key}" + (f".{item_index}" if isinstance(value, list) else "")
                        yield field, item


def evidence_units(quote: str):
    """Keep complete bullets/sentences, with exact offsets into the full field.

    Contrast words and semicolons stay inside their sentence so qualification or
    uncertainty context cannot be lost through keyword-centered truncation.
    """
    cursor = 0
    units = []
    for raw in quote.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        left, right = content_start(line), len(line.rstrip())
        last = left
        boundaries = list(re.finditer(r"(?<=[.!?])\s+(?=[A-ZÀ-Ý])|\s+[•●▪◦▸]\s+", line[left:right]))
        for boundary in [*boundaries, None]:
            end = left + boundary.start() if boundary else right
            piece = line[last:end]
            start = last + len(piece) - len(piece.lstrip())
            end = last + len(piece.rstrip())
            if end > start:
                units.append((cursor + start, cursor + end, line[start:end]))
            if boundary:
                last = left + boundary.end()
        cursor += len(raw)
    merged = []
    for start, end, piece in units:
        if merged and re.match(r"^(?:however|but|yet|although|nevertheless|despite|cependant|pourtant|mais|toutefois|en revanche|bien que|sans pour autant)\b", norm(piece)):
            previous_start, _, _ = merged.pop()
            merged.append((previous_start, end, quote[previous_start:end]))
        else:
            merged.append((start, end, piece))
    yield from merged


def source_evidence(field: str, quote: str, start: int, end: int) -> CandidateRequirementEvidence:
    excerpt = CandidateEvidenceExcerpt(quote=quote[start:end], start=start, end=end) if start != 0 or end != len(quote) else None
    return CandidateRequirementEvidence(field=field, quote=quote, excerpt=excerpt)


def deduplicate_evidence(evidence: list[CandidateRequirementEvidence]) -> list[CandidateRequirementEvidence]:
    return list({(item.field, item.excerpt.quote if item.excerpt else item.quote): item for item in reversed(evidence)}.values())[::-1]


def relevant_evidence(field: str, quote: str, matches: Callable[[str], bool]) -> list[CandidateRequirementEvidence]:
    evidence = [source_evidence(field, quote, start, end) for start, end, piece in evidence_units(quote) if matches(piece)]
    return deduplicate_evidence(evidence)


def technical_profile_index(leaves: list[tuple[str, str]]) -> dict[str, list[CandidateRequirementEvidence]]:
    """Reuse canonical recognition once per field/span across both result views."""
    index: dict[str, list[CandidateRequirementEvidence]] = {}
    for field, quote in leaves:
        names = {skill.name for skill in skills_in(quote)}
        units = [(start, end, {skill.name for skill in skills_in(piece)}) for start, end, piece in evidence_units(quote)] if names else []
        for name in names:
            evidence = [source_evidence(field, quote, start, end) for start, end, found in units if name in found]
            # A full-field context can disambiguate an alias even when an
            # isolated sentence cannot. Keep that context instead of guessing.
            index.setdefault(name, []).extend(evidence or [CandidateRequirementEvidence(field=field, quote=quote)])
    return {name: deduplicate_evidence(evidence) for name, evidence in index.items()}


def experience_evidence(original: JobRequirement, leaves: list[tuple[str, str]], technical_index: dict[str, list[CandidateRequirementEvidence]]) -> list[CandidateRequirementEvidence]:
    if original.technical_skills:
        return deduplicate_evidence([item for skill in original.technical_skills for item in technical_index.get(skill.name, []) if item.field.startswith("experience.")])
    source = norm(original.text)
    words = {word for word in re.findall(r"\w+", source) if len(word) >= 3 and not word.isdigit()} - GENERIC_EXPERIENCE_WORDS
    sector = bool(re.search(r"\b(?:sector|industry|secteur|industrie)\b", source))
    evidence = []
    for field, quote in leaves:
        if not field.startswith("experience."):
            continue
        if not words:
            if field.endswith(".job_title"):
                evidence.append(CandidateRequirementEvidence(field=field, quote=quote))
            continue
        def matches(piece: str) -> bool:
            cleaned = norm(piece)
            overlap = words & set(re.findall(r"\w+", cleaned))
            if not overlap:
                return False
            if sector:
                # A domain technology or an employer name is not industry
                # employment. Require an explicit sector/employment statement.
                return bool(re.search(r"\b(?:sector|industry|secteur|industrie)\b|\b(?:worked|employed|employment|travaill\w*|emploi)\b.{0,80}\b(?:in|within|dans)\b", cleaned))
            return True
        evidence.extend(relevant_evidence(field, quote, matches))
    return deduplicate_evidence(evidence)


def validate_review(request: JobComparisonRequest, analyzer: JobAnalyzer) -> JobAnalysisResponse:
    if not request.review.candidate_confirmed or not request.review.requirements_reviewed:
        raise JobWorkflowError("review_required", "Confirm the reviewed candidate and review the extracted job requirements before comparison.")
    if request.review.candidate_snapshot != request.candidate or request.review.requirement_snapshot != request.requirements:
        raise JobWorkflowError("review_stale", "A qualification profile or requirement changed after review. Review and confirm the current values again.")
    original = analyzer.analyze(request.job_analysis.job.text)
    if original != request.job_analysis:
        raise JobWorkflowError("source_mismatch", "Original analysis fields and source evidence must match a fresh analysis of the submitted job description.")
    originals = {item.id: item for item in original.requirements}
    if len({item.id for item in request.requirements}) != len(request.requirements):
        raise JobWorkflowError("duplicate_requirement", "Each reviewed requirement ID must occur once.")
    for reviewed in request.requirements:
        extracted = originals.get(reviewed.id)
        if not extracted:
            raise JobWorkflowError("unknown_requirement", "Reviewed requirements must refer to an extracted, source-supported requirement.")
        if PROTECTED.search(norm(reviewed.text)) or NEGATED_JOB.search(norm(reviewed.text)):
            raise JobWorkflowError("unsupported_correction", "Corrections must remain job-related positive qualification wording supported by the original source.")
        # Fresh analysis above already verifies every original skill against its
        # complete source context. Origin describes what the clause establishes,
        # not the heading under which its aliases were recognized: an explicit
        # qualification can still occur within a technical-environment section.
        # Re-parsing untouched text using origin loses that heading context and
        # can incorrectly reject supported lowercase list aliases (api, ai, ml).
        if reviewed.text != extracted.text:
            skills = skills_in(reviewed.text, technical_context=True)
            if {item.name for item in skills} != {item.name for item in extracted.technical_skills}:
                raise JobWorkflowError("unsupported_correction", "An edited label cannot add or remove source technical qualifications. Reanalyze a corrected source to change them.")
        supported_categories = categories_in(extracted.text, extracted.technical_skills)
        supported_categories.add(extracted.category)  # Section-established education/experience remains valid.
        supported_categories.add("other")  # A reviewer can request conservative manual interpretation.
        if reviewed.category not in supported_categories:
            raise JobWorkflowError("unsupported_category", "The corrected category must be supported by the original requirement evidence.")
        # Nontechnical qualification labels may be corrected stylistically,
        # but cannot introduce new years/degrees/certifications/languages.
        if norm(reviewed.text) != norm(extracted.text):
            original_words = normalized_label_words(extracted.text)
            added = normalized_label_words(reviewed.text) - original_words
            allowed = {"required", "preferred", "mandatory", "optional", "requis", "requise", "souhaite", "souhaitee", "obligatoire"}
            if added - allowed:
                raise JobWorkflowError("unsupported_correction", "Corrections must retain the source qualification wording. Edit the source and reanalyze to introduce a new qualification.")
    return original


def compare_requirement(original: JobRequirement, reviewed, leaves, technical_index: dict[str, list[CandidateRequirementEvidence]] | None = None) -> RequirementComparison:
    technical_index = technical_index if technical_index is not None else technical_profile_index(leaves)
    notes = list(original.warnings)
    if reviewed.text != original.text or reviewed.category != original.category or reviewed.classification != original.classification:
        notes.append("A human supplied a corrected label or classification; the original extraction and exact source evidence are shown separately.")
    evidence, status = [], "needs_review"
    if original.origin == "technical_environment":
        for skill in original.technical_skills:
            evidence.extend(technical_index.get(skill.name, []))
        evidence = deduplicate_evidence(evidence)
        explanation = "These technologies appear only in the job's technical environment. Related profile mentions are unverified context; no required candidate qualification or proficiency can be established from this list."
        notes.append("A corrected classification does not turn source environment information into an explicit qualification. Reanalyze source wording that explicitly states a candidate requirement before interpreting it as one.")
    elif reviewed.category == "technical_skill" and original.technical_skills:
        found = set()
        for skill in original.technical_skills:
            matches = technical_index.get(skill.name, [])
            if matches:
                found.add(skill.name)
                evidence.extend(matches)
        evidence = deduplicate_evidence(evidence)
        ambiguous = bool(original.warnings) or bool(re.search(r"\b(?:\d+|minimum|at least|au moins|mastery|maitrise|proficien\w*|fluent|courant|expert\w*|advanced|avance\w*|familiarity|capacite|capabilit\w*)\b|\b(?:knowledge|connaissance)\b.{0,45}\b(?:stack|pile)\b", norm(original.text)))
        status = "needs_review" if ambiguous else "documented" if len(found) == len(original.technical_skills) else "not_documented"
        explanation = "The profile explicitly mentions every named technology; these mentions remain unverified and do not establish proficiency." if status == "documented" else "Supporting mentions for one or more named technologies were not found in the qualification profile." if status == "not_documented" else "Technology mentions can be shown, but alternatives, proficiency wording or combined qualifications require human interpretation."
    elif reviewed.category == "language":
        names = language_names(original.text)
        for name in names:
            match = next(((field, quote) for field, quote in leaves if field.startswith("languages.") and field.endswith(".name") and name in language_names(quote)), None)
            if match:
                evidence.append(CandidateRequirementEvidence(field=match[0], quote=match[1]))
        qualitative = bool(original.warnings) or bool(re.search(r"\b(?:fluent|fluency|courant|bilingue|professional|professionnel\w*|proficien\w*|[abc][12])\b", norm(original.text)))
        status = "needs_review" if qualitative or not names else "documented" if len(evidence) == len(names) else "not_documented"
        explanation = "Language names are documented as unverified profile statements." if status == "documented" else "A named job-related language was not found in the profile; this does not establish inability." if status == "not_documented" else "Language proficiency and the intended level need human review; a simple language mention does not establish a level."
    elif reviewed.category in {"education", "certification"}:
        section = "education." if reviewed.category == "education" else "certifications."
        source = norm(original.text)
        # Exact names can establish a mention, while partial certification
        # names and degree equivalence need human interpretation.
        expected = degree_names(source) if reviewed.category == "education" else set()
        named_certification = re.sub(r"\b(?:certification|certificate|certificat|required|mandatory|preferred|requis\w*|obligatoire\w*|souhaite\w*)\b", "", source).strip(" .,:;-")
        named_certification = re.sub(r"^(?:a|an|the|une?|la|le)\s+", "", named_certification)
        named_certification = re.sub(r"\s+", " ", named_certification)
        for field, quote in leaves:
            if not field.startswith(section):
                continue
            cleaned = norm(quote)
            if reviewed.category == "education" and expected & degree_names(quote) or reviewed.category == "certification" and len(cleaned) >= 4 and cleaned in source:
                evidence.append(CandidateRequirementEvidence(field=field, quote=quote))
        if not evidence:
            status = "not_documented" if expected or reviewed.category == "certification" else "needs_review"
        else:
            status = "needs_review" if original.warnings else "documented"
            if reviewed.category == "certification" and not any(norm(item.quote) == named_certification for item in evidence):
                status = "needs_review"
            if reviewed.category == "education":
                field_match = re.search(r"\b(?:in|en|dans)\s+(.+)", source)
                if field_match:
                    required_field = field_match[1]
                    required_field = REQUIRED.sub("", PREFERRED.sub("", required_field)).strip(" .,-")
                    record_prefixes = {item.field.rsplit(".", 1)[0] for item in evidence}
                    field_evidence = next(((field, quote) for field, quote in leaves if field.endswith(".field_of_study") and field.rsplit(".", 1)[0] in record_prefixes and norm(quote) == required_field), None)
                    if field_evidence:
                        evidence.append(CandidateRequirementEvidence(field=field_evidence[0], quote=field_evidence[1]))
                    else:
                        status = "needs_review"
        explanation = "The exact named education or certification is stated in the profile; this statement remains unverified and does not establish equivalence or accreditation." if status == "documented" else "Related education or certification statements are shown, but the full name, equivalence or field requirements need human review." if evidence else "No supporting education or certification statement was found. Equivalence and implicit qualification systems are not inferred."
    elif reviewed.category == "experience":
        evidence = experience_evidence(original, leaves, technical_index)
        status = "needs_review" if evidence else "not_documented"
        explanation = "Related experience text is documented, but duration, scope, seniority and equivalence require human review. No years of experience are computed." if evidence else "No related experience statement was found in the submitted qualification fields. This does not establish lack of experience."
    else:
        concepts = business_concepts(original.text)
        if concepts:
            for field, quote in leaves:
                if field.startswith(("experience.", "projects.", "technical_skills.")):
                    evidence.extend(relevant_evidence(field, quote, lambda piece: bool(concepts & business_concepts(piece))))
            evidence = deduplicate_evidence(evidence)
        explanation = "Related business-analysis statements are documented as unverified source excerpts. Mastery, completeness, scope and equivalence still require human interpretation." if evidence else "This qualification wording has no supported deterministic comparison rule and requires human interpretation."
    if status == "needs_review":
        notes.append("A human must interpret this requirement; no suitability or eligibility conclusion is produced.")
    return RequirementComparison(requirement_id=reviewed.id, requirement_text=reviewed.text, original_requirement_text=original.text, category=reviewed.category, classification=reviewed.classification, origin=original.origin, status=status, candidate_evidence=evidence, job_evidence=original.evidence, explanation=explanation, review_notes=notes)


def summarize_technical_evidence(requirements: list[JobRequirement], comparisons: list[RequirementComparison], leaves: list[tuple[str, str]], candidate_index: dict[str, list[CandidateRequirementEvidence]] | None = None) -> list[TechnicalEvidence]:
    """Index filtered profile mentions once; aggregate source-bound provenance.

    The same longest-phrase vocabulary and filtered qualification leaves used by
    the checklist establish lexical evidence. Original clauses, not corrected
    labels, establish job technologies and source classifications. This overview
    never changes a requirement status or turns an environment into a criterion.
    """
    job_names = {skill.name for requirement in requirements for skill in requirement.technical_skills}
    if not job_names:
        return []
    candidate_index = candidate_index if candidate_index is not None else technical_profile_index(leaves)

    comparison_by_id = {item.requirement_id: item for item in comparisons}
    summary: dict[str, TechnicalEvidence] = {}
    for requirement in requirements:
        row = comparison_by_id[requirement.id]
        requires_interpretation = requirement.origin == "technical_environment" or requirement.classification == "unspecified" or row.status == "needs_review"
        reference = TechnicalJobReference(requirement_id=requirement.id, origin=requirement.origin, classification=requirement.classification, evidence=requirement.evidence)
        for skill in requirement.technical_skills:
            if skill.name not in summary:
                summary[skill.name] = TechnicalEvidence(name=skill.name, category=skill.category, job_references=[reference], candidate_evidence=candidate_index.get(skill.name, []), requires_interpretation=requires_interpretation)
            else:
                item = summary[skill.name]
                if reference not in item.job_references:
                    item.job_references.append(reference)
                item.requires_interpretation = item.requires_interpretation or requires_interpretation
    return list(summary.values())


def compare_job(request: JobComparisonRequest, analyzer: JobAnalyzer | None = None) -> JobComparisonResponse:
    original = validate_review(request, analyzer or DeterministicJobAnalyzer())
    originals = {item.id: item for item in original.requirements}
    leaves = list(qualification_leaves(request.candidate))
    technical_index = technical_profile_index(leaves)
    requirements = [originals[item.id] for item in request.requirements]
    comparisons = [compare_requirement(originals[item.id], item, leaves, technical_index) for item in request.requirements]
    return JobComparisonResponse(comparisons=comparisons, warnings=LIMITATIONS, technical_evidence=summarize_technical_evidence(requirements, comparisons, leaves, technical_index))
