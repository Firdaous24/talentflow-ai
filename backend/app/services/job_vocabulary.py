"""Job-only aliases: preserve CV extraction and never equate nested services."""

import re
import unicodedata

from app.models.job import JobSkill
from app.services.extraction import TECHNOLOGIES


def norm(value: str) -> str:
    return "".join(character for character in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(character))


# Copy every mapping rather than mutating the shared candidate vocabulary.
JOB_TECHNOLOGIES = {category: dict(names) for category, names in TECHNOLOGIES.items()}
JOB_TECHNOLOGIES["ai_ml"].update({
    "AI": ("ai", "artificial intelligence", "intelligence artificielle", "ia"),
    "Generative AI": ("generative ai", "genai", "generative artificial intelligence", "ia generative", "intelligence artificielle generative"),
    "LLMs": ("llm", "llms", "large language model", "large language models"),
    "OpenAI": ("openai",),
    "Azure AI": ("azure ai", "microsoft azure ai"),
    "Azure OpenAI": ("azure openai", "microsoft azure openai"),
    "AI Agents": ("ai agents", "agents ia"),
    "AI Workflows": ("ai workflows", "workflows ai", "workflows ia"),
    "Machine Learning": ("machine learning", "apprentissage automatique", "ml"),
    "MLOps": ("mlops", "ml ops"),
    "RAG": ("rag", "retrieval augmented generation", "retrieval-augmented generation"),
})
JOB_TECHNOLOGIES["cloud_devops"].update({
    "Azure": ("azure", "microsoft azure"),
    "GCP": ("gcp", "google cloud platform"),
    "Cloud Computing": ("cloud computing", "informatique en nuage", "cloud"),
})
JOB_TECHNOLOGIES["database"].update({"Teradata": ("teradata",)})
JOB_TECHNOLOGIES["tool"].update({
    "Airflow": ("apache airflow", "airflow"),
    "Microservices": ("microservices", "micro-services", "micro services"),
    "API": ("api", "apis", "application programming interface", "application programming interfaces"),
    "HLD": ("hld", "high level design", "high-level design"),
    "LLD": ("lld", "low level design", "low-level design"),
})

SHORT_TECHNICAL = {"ai", "ia", "ml", "api", "apis", "hld", "lld", "gcp"}
TECHNICAL_WORDING = re.compile(r"\b(?:required|preferred|requis\w*|souhaite\w*|obligatoire\w*|proficien\w*|experience|knowledge|connaissance|maitrise|programming|architecture\w*|computing|technical|technique|technology|technologie\w*|engineer\w*|ingenieur\w*|developer\w*|developpeur\w*|design|services?|integration|endpoints?|models?|modeles?|systems?|systemes?|deployment|deploiement)\b")


def alias_matches(text: str, technical_context: bool = False):
    # Blanking URLs and contacts preserves positions in the normalized string.
    source = re.sub(r"https?://\S+|[^\s@]+@[^\s@]+\.[^\s@]+|(?<!\w)#\w+", lambda match: " " * len(match[0]), text, flags=re.I)
    cleaned = norm(source)
    matches = []
    list_context = technical_context or bool(re.search(r"[/|,;•]", source)) or bool(TECHNICAL_WORDING.search(cleaned))
    for category, names in JOB_TECHNOLOGIES.items():
        for name, configured in names.items():
            aliases = configured
            if name == "Go" and (re.fullmatch(r"\s*go\s*(?:required|preferred|requis|souhaite)?[.!]?\s*", cleaned) or re.search(r"\b(?:go (?:programming|language)|(?:with|using|en) go)\b", cleaned)):
                aliases = (*aliases, "go")
            for alias in aliases:
                normalized_alias = norm(alias)
                for match in re.finditer(r"(?<![\w+#])" + re.escape(normalized_alias) + r"(?![\w+#])", cleaned):
                    if normalized_alias == "gcp" and re.search(r"\b(?:clinical|clinique\w*|good clinical practice|bonnes? pratiques? cliniques?)\b", cleaned):
                        continue
                    if normalized_alias == "airflow" and re.search(r"\b(?:ventilation|hvac|air quality|air circulation|wind|aerodynamic\w*|ventil\w*)\b", cleaned):
                        continue
                    if normalized_alias in SHORT_TECHNICAL:
                        # French 'ai' and 'la' prose, and lowercase 'ml' units,
                        # do not identify a technology. Lists/labels supply context.
                        actual = source[match.start():match.end()]
                        if normalized_alias == "ai" and re.search(r"j['’]$", cleaned[:match.start()]):
                            continue
                        if not actual.isupper():
                            fragment = re.split(r"[/|,;•]", cleaned[:match.start()])[-1] + normalized_alias + re.split(r"[/|,;•]", cleaned[match.end():])[0]
                            if not technical_context or fragment.strip(" .!:") != normalized_alias:
                                continue
                        if not list_context and cleaned.strip(" .!:") != normalized_alias:
                            continue
                    if normalized_alias == "cloud":
                        fragment = re.split(r"[/|,;•]", cleaned[:match.start()])[-1] + "cloud" + re.split(r"[/|,;•]", cleaned[match.end():])[0]
                        if not TECHNICAL_WORDING.search(cleaned) and fragment.strip(" .!:") != "cloud":
                            continue
                    matches.append((match.start(), match.end(), name, category))
    # Prefer the longest service/phrase before accepting any nested aliases.
    accepted = []
    for item in sorted(matches, key=lambda item: (-(item[1] - item[0]), item[0])):
        if not any(item[0] < previous[1] and item[1] > previous[0] for previous in accepted):
            accepted.append(item)
    return cleaned, accepted


def skills_in(text: str, technical_context: bool = False) -> list[JobSkill]:
    _, matches = alias_matches(text, technical_context)
    selected = {item[2] for item in matches}
    return [JobSkill(name=name, category=category) for category, names in JOB_TECHNOLOGIES.items() for name in names if name in selected]


def normalized_label_words(text: str) -> set[str]:
    cleaned, matches = alias_matches(text, technical_context=True)
    for start, end, name, _ in sorted(matches, reverse=True):
        cleaned = cleaned[:start] + "skill" + re.sub(r"\W", "", norm(name)) + cleaned[end:]
    return set(re.findall(r"\w+", cleaned))
