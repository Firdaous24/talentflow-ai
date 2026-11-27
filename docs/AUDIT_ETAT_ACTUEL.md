# Audit de l'état actuel — TalentFlow AI

*Audit en lecture seule réalisé le 2026-11-27 sur le poste local (Windows 11), branche `main`. Aucun fichier de code modifié, aucun commit, aucune installation. Ce document est le seul fichier créé.*

---

## 1. Résumé exécutif

- **Le code est plus avancé que le dossier de synthèse : la Phase 5 (LangGraph réel avec interrupt/resume + page AI Agents) est implémentée et fonctionnelle**, avec 69 tests backend et 16 tests frontend dédiés.
- **Mais presque rien n'est commité.** Le dernier commit (`cd543aa`, 2026-10-12) correspond à la **Phase 3.6**. Toutes les phases 4, 4.1, 4.2, 4.3, 4.3.1 et 5 (≈ 21 000 lignes non suivies + 15 fichiers modifiés) n'existent **que dans le répertoire de travail local**. Aucun tag, une seule branche. **C'est le risque n°1 : une perte du disque ou un `git checkout .` efface deux mois de travail.**
- Tests réellement exécutés : **backend 649 passés / 0 échec / 0 ignoré** (17,7 s, Windows, Python 3.11). Soit 580 (Phase 4.3.1) + 69 (Phase 5). C'est cohérent avec le README.
- `tsc --noEmit` : **0 erreur**. **Vitest n'a pas pu tourner** : Node.js absent de l'hôte et `node_modules` installé pour Linux. Le dénombrement statique (88 déclarations, dont un `it.each` ×3, soit **90 cas**) correspond au chiffre du README (74 + 16).
- Docker Desktop est arrêté : seule la commande `docker compose config --quiet` a été validée (OK). Ni démarrage de la stack ni tests E2E (9 scripts Chromium présents).
- Les garde-fous métier sont bien en place dans le code : pas de score ni de classement, comparaison bloquée sans double revue, projection limitée aux qualifications, aucun appel LLM sans configuration **et** consentement explicite.
- Aucun secret ni CV réel dans Git. `.env` existe localement mais est ignoré et n'apparaît pas dans l'historique.
- Pas de CI, pas de linter (ni ESLint, ni ruff, ni mypy), pas de `.gitattributes` (avertissements CRLF/LF sur chaque fichier modifié).

---

## 2. Carte de l'architecture

### 2.1 Arborescence commentée

Légende : (C) commité, (M) modifié non commité, (N) nouveau non suivi.

```
talentflow-ai/
├── .env                      # local, ignoré, NON lu (contient les identifiants Postgres)
├── .env.example              # (C) espaces réservés Postgres + LLM_* vides
├── .gitignore / .dockerignore
├── .artifacts/               # ignoré : captures, snapshots "baseline" du code par phase, JSON de debug
├── docker-compose.yml        # (C) frontend (nginx:8080→127.0.0.1:5173), backend (127.0.0.1:8000), db Postgres 17.11 (épinglé par digest)
├── compose.dev.yaml          # (C) bind-mount en lecture seule + --reload
├── compose.test.yaml         # (C) cible "test" du backend, pytest
├── README.md                 # (M) décrit les phases 1→5 comme implémentées
├── backend/
│   ├── Dockerfile            # (M) multi-stage base/test/runtime, non-root
│   ├── requirements.txt      # (M) +langgraph==1.2.15
│   ├── requirements.lock     # (M) contraintes résolues sous Linux (langchain-core, langsmith… transitives)
│   ├── evaluate*.py          # scripts d'évaluation hors-ligne (evaluate.py (C), 3 autres (N))
│   ├── app/
│   │   ├── main.py           # (M) FastAPI, CORS localhost:5173, 2 middlewares, 4 routers, lifespan WorkflowManager
│   │   ├── api/
│   │   │   ├── upload_limits.py        # (C) borne le corps multipart à 5 MiB + 64 KiB avant le parsing
│   │   │   └── routes/
│   │   │       ├── health.py           # (C) GET /api/v1/health
│   │   │       ├── candidates.py       # (C) POST /parse, GET /extraction-config
│   │   │       ├── jobs.py             # (N) POST /analyze, POST /compare, GET /capabilities
│   │   │       └── agents.py           # (N) 6 routes de workflow LangGraph
│   │   ├── models/
│   │   │   ├── candidate.py            # (C) CandidateProfile, FieldEvidence, CVParsingResponse
│   │   │   └── job.py                  # (N) JobAnalysis*, QualificationProfile, JobComparison*, CandidateEvidenceExcerpt
│   │   ├── services/
│   │   │   ├── pdf.py                  # (C) PyMuPDF, limites, verrou global (MuPDF non thread-safe)
│   │   │   ├── layout.py               # (C) ordre de lecture multi-colonnes
│   │   │   ├── sections.py             # (M) alias de sections CV (+ projets académiques)
│   │   │   ├── multilingual.py         # (M) FR/EN, dates, rôles (+ business analyst)
│   │   │   ├── extraction.py           # (C) extracteur déterministe
│   │   │   ├── records.py              # (C) découpage des entrées
│   │   │   ├── llm.py                  # (C) fournisseur OpenAI-compatible optionnel, consentement obligatoire
│   │   │   ├── jobs.py                 # (N, 563 l.) analyse d'offre déterministe + comparaison par preuves
│   │   │   ├── job_formatting.py       # (N) en-têtes, métadonnées, lignes fantômes, contacts
│   │   │   └── job_vocabulary.py       # (N) normalisation, alias techniques
│   │   └── agents/                     # (N) PHASE 5
│   │       ├── graph.py                # StateGraph à 7 nœuds, interrupt() réel
│   │       ├── checkpoints.py          # WorkflowManager : InMemorySaver par workflow, TTL 30 min, 32 max, verrous
│   │       ├── middleware.py           # restriction Host/Origin locale + borne 512 KiB
│   │       ├── verification.py         # hash de snapshot, minimisation, vérification indépendante des preuves
│   │       ├── schemas.py / state.py / errors.py
│   └── tests/                # 20 fichiers test_*.py, 649 tests, fixtures JSON fictives
├── frontend/
│   ├── Dockerfile            # (C) dependencies/test/build/runtime (nginx-unprivileged)
│   ├── nginx.conf            # (C) proxy /api/ → backend:8000, client_max_body_size 6m, no-store
│   ├── e2e/                  # Dockerfile Playwright 1.58.2 (M) + 10 scripts .mjs (9 parcours + helper)
│   └── src/
│       ├── App.tsx           # (M) shell, routes, Dashboard / Candidates / CandidateDetail / Settings / NotFound inline
│       ├── pages/Parser.tsx  # (C) upload CV
│       ├── pages/JobAnalysis.tsx   # (N, 1107 l.) analyse d'offre, revue des critères, comparaison
│       ├── pages/AIAgents.tsx      # (N) chronologie, revue humaine, Review & Resume
│       ├── components/       # ReviewProfile (M), Profile, ExtractionWarnings, ErrorBoundary, ComparisonResults (N, 729 l.)
│       ├── session.tsx / jobSession.tsx / agentSession.tsx   # état React en mémoire uniquement
│       ├── api.ts (M) / jobApi.ts (N) / agentApi.ts (N)      # clients HTTP
│       ├── comparison.ts (N) # comparisonBlockers() : conditions de blocage côté UI
│       └── test/             # 9 fichiers Vitest
├── docs/                     # 13 docs techniques (5 commités, 8 nouveaux)
└── evaluation/               # résultats JSON des évaluations (fictifs)
```

**Routes frontend** (`App.tsx:177-184`) : `/` Dashboard, `/parser`, `/candidates`, `/candidates/:id`, `/matching` (Job Analysis), `/agents`, `/settings`, `*`.

### 2.2 Flux de données

```
PDF (≤ 5 MiB, ≤ 10 pages, pas d'OCR)
  │ POST /api/v1/candidates/parse  [UploadLimitMiddleware → extract_pdf → extracteur déterministe
  │                                  (ou EvidenceCheckedExtractor si use_llm ET external_consent ET fournisseur configuré)]
  ▼
CVParsingResponse (champs + preuves) ─► session React (mémoire) ─► ReviewProfile : revue + CONFIRMATION humaine
                                                                          │
Texte d'offre (30–30 000 car.)                                            │ qualificationSnapshot()
  │ POST /api/v1/jobs/analyze → DeterministicJobAnalyzer                  │ (sans identité, contact, employeur, lieu, dates)
  ▼                                                                       ▼
JobAnalysisResponse (exigences + offsets source) ─► revue/correction des critères ─► ACCUSÉ de revue
                                                                          │
                     ┌────────────────────────────────────────────────────┤
                     ▼                                                    ▼
POST /api/v1/jobs/compare                          POST /api/v1/agents/workflows (Phase 5)
  validate_review() : double revue, snapshots,       intake → candidate → job → compare (compare_job inchangé)
  ré-analyse fraîche de la source = identique        → verify → human_review [interrupt] ──► GET …/{id} (pause)
  → compare_requirement() par exigence               POST …/resume (Command(resume=…)) → final_report (re-vérification)
  ▼                                                  ▼
JobComparisonResponse : documented / not_documented / needs_review + candidate_evidence + technical_evidence
(aucun score, aucun classement, avertissements LIMITATIONS systématiques)
```

---

## 3. Tableau phase par phase

| Phase | Attendu (dossier) | Constaté dans le code | Commité ? | Écart |
|---|---|---|---|---|
| 1 Fondation backend | FastAPI, health | `main.py`, `health.py`, `GET /` | Oui (`0815a72`) | Aucun |
| 2 / 2.5 Docker | Compose, Postgres 17 | 3 services, loopback, non-root, digests épinglés | Oui (`ef6e5ff`) | Postgres provisionné mais **non utilisé** par l'appli |
| 3 → 3.6 Parsing CV, revue | PyMuPDF, FR/EN, preuves, revue humaine | `pdf.py`, `layout.py`, `extraction.py`, `multilingual.py`, `ReviewProfile.tsx` | Oui (`cd543aa`) | Petites retouches non commitées dans `sections.py` et `multilingual.py` |
| 4 Analyse d'offre + comparaison | `/jobs/analyze`, `/jobs/compare`, 3 statuts | `jobs.py`, `models/job.py`, `JobAnalysis.tsx` | **Non** | Conforme mais non versionné |
| 4.1 Offres réalistes | corpus réaliste | `jobs_realistic.json`, `test_jobs_realistic*.py` (152 tests) | **Non** | idem |
| 4.2 UX des résultats | `ComparisonResults.tsx`, aperçu technique | présent, `technical_evidence` | **Non** | idem |
| 4.3 Précision réelle | `excerpt` quote/start/end | `CandidateEvidenceExcerpt` + validateur d'offsets | **Non** | idem |
| 4.3.1 Corrections finales | lignes `\` seules, « minimum X ans » → Required | `meaningful_clause()`, `minimum_experience()` + `classify()` ; 85 tests dans `test_final_job_accuracy.py` | **Non** | idem |
| **5 LangGraph** | « spécifiée, non confirmée » | **Implémentée** : StateGraph 7 nœuds, `interrupt`, `Command(resume)`, InMemorySaver, 6 routes, page `/agents` | **Non** | **Le dossier est en retard sur le code** |

### 3.1 Routes FastAPI réellement déclarées

| Route | Attendue | Présente | Remarque |
|---|---|---|---|
| `GET /` | ✅ | ✅ | `main.py` |
| `GET /api/v1/health` | ✅ | ✅ | liveness seule, ne vérifie pas la DB |
| `POST /api/v1/candidates/parse` | ✅ | ✅ | |
| `POST /api/v1/jobs/analyze` | ✅ | ✅ | |
| `POST /api/v1/jobs/compare` | ✅ | ✅ | |
| `GET /api/v1/jobs/capabilities` | ✅ | ✅ | |
| `GET /api/v1/candidates/extraction-config` | — | ➕ en plus | expose seulement si un fournisseur est configuré, sans identifiants |
| `POST /api/v1/agents/workflows` | Phase 5 | ➕ | start (201) |
| `GET /api/v1/agents/workflows/{id}` | Phase 5 | ➕ | status |
| `GET /api/v1/agents/workflows/{id}/review` | Phase 5 | ➕ | **non appelé par le frontend** |
| `POST /api/v1/agents/workflows/{id}/resume` | Phase 5 | ➕ | |
| `POST /api/v1/agents/workflows/{id}/cancel` | Phase 5 | ➕ | |
| `GET /api/v1/agents/workflows/{id}/report` | Phase 5 | ➕ | **non appelé par le frontend** |
| `/docs`, `/openapi.json` | — | ➕ | Swagger FastAPI |

Aucune route attendue ne manque.

### 3.2 Vérifications fonctionnelles

| Point | Constat | Référence |
|---|---|---|
| Limites d'upload | `MAX_UPLOAD_BYTES = 5 * 1024 * 1024` (5 MiB), `MAX_PAGES = 10`, `MAX_TEXT_CHARACTERS = 200_000`. Corps multipart borné à 5 MiB + 64 KiB par le middleware ; nginx 6 MiB. PDF chiffrés, réparés, sans `%%EOF` ou sans texte : refusés. | `backend/app/services/pdf.py:11-13`, `backend/app/api/upload_limits.py:8` |
| Limites d'offre | 30 à 30 000 caractères, au moins 15 lettres, pas d'octet nul ; 150 exigences max | `backend/app/models/job.py:15-24` |
| 3 statuts | `Literal["documented","not_documented","needs_review"]` | `backend/app/models/job.py:146` |
| `candidate_evidence` | `field`, `quote`, `unverified: True`, `excerpt` optionnel (`quote/start/end`), validé par slicing Python, donc **en points de code Unicode**. Omis du JSON quand absent (`exclude_if`). | `backend/app/models/job.py:124-141` |
| Projection qualification seule | `QualificationProfile` : education (degree, field_of_study), experience (job_title, description, technologies), skills, projects, certifications, languages. **Aucun** champ nom, contact, employeur, lieu ou dates ; `extra="forbid"` hérité de `Schema`. Filtrage supplémentaire des textes protégés, négatifs ou de contact dans `qualification_leaves()`. | `backend/app/models/job.py:76-110`, `backend/app/services/jobs.py:315` |
| Blocage avant double revue | Backend : `validate_review()` exige `candidate_confirmed` ET `requirements_reviewed`, des snapshots identiques et une ré-analyse de la source identique, sinon 422. Frontend : `comparisonBlockers()` désactive le bouton. Graphe : nœuds `candidate_preparation` et `job_preparation` → `blocked`. | `backend/app/services/jobs.py:390`, `frontend/src/comparison.ts` |
| Pas de score ni de classement | Aucune occurrence de `score`/`rank` dans `backend/app` ni dans `frontend/src` (hors tests). `LIMITATIONS` est renvoyé à chaque comparaison. | — |
| Pas de LLM sans consentement | `use_llm` sans `external_consent` → `consent_required`. Fournisseur actif seulement si `LLM_*` est défini (vides par défaut). Jobs et agents : `external_model_calls: False` ; tracing LangSmith désactivé explicitement (`tracing_context(enabled=False)`). | `backend/app/api/routes/candidates.py:34`, `backend/app/agents/checkpoints.py:111` |
| 4.3.1 lignes fantômes | `meaningful_clause()` retire `\n`, `\r`, `\t` littéraux, `<br>` et `&nbsp;`, puis exige un caractère alphanumérique. Une ligne `\` seule est ignorée ; `C++`, `C#` et `.NET` sont conservés. Tests paramétrés. | `backend/app/services/job_formatting.py:23`, `backend/tests/test_final_job_accuracy.py:37-45` |
| 4.3.1 « minimum X ans » | `MINIMUM_DURATION` + `minimum_experience()` (section requirements/experience uniquement, ancré sur « expérience ») → `required`, sauf si la section est `preferred` ou si la phrase est conditionnelle, hypothétique, entre guillemets ou négative. | `backend/app/services/jobs.py:56,146-167` |

---

## 4. Résultats des tests, du lint et des types

| Contrôle | Commande | Résultat | Référence (dossier/README) |
|---|---|---|---|
| Tests backend | `backend/.venv/Scripts/python -m pytest -p no:cacheprovider -q` | **649 passés, 0 échec, 0 ignoré** (17,65 s) | Dossier : 580 (4.3.1) ; README : 649 (Phase 5) ✅ |
| Répartition | `--co` par fichier | jobs_realistic 125 · final_job_accuracy 85 · jobs 69 · agents_graph 35 · agents_api 34 · accuracy 32 · multilingual 32 · technical_evidence 29 · comparison_accuracy_eval 27 · jobs_realistic_eval 27 · extraction 26 · candidates 23 · comparison_workflow 23 · real_world_comparison 22 · cv_section_boundaries 17 · llm 17 · job_evaluation 15 · main 5 · pdf 5 · upload_limits 1 | 580 + 69 (agents) = 649 |
| Tests frontend | `vitest run` | **Non exécutés.** Node.js absent du PATH ; via le runtime Node 24 de VS Code, échec `Cannot find module '@rollup/rollup-win32-x64-msvc'` car `node_modules` ne contient que `rollup-linux-x64-musl`. | Dossier : 74 ; README : 90 |
| Dénombrement statique | grep `it(`/`test(` | 88 déclarations, dont `it.each` à 3 cas, soit **90 cas** : agents 12 (+2), agentsApi 2, api 10, comparisonResults 14, comparisonWorkflow 10, jobAnalysis 27, profile 3, review 2, workflow 8 | Cohérent avec 74 + 16 |
| Types TS | `tsc --noEmit -p tsconfig.json` (runtime Node de VS Code) | **0 erreur** (mode `strict`, `noUnusedLocals`, `noUnusedParameters`) | ✅ |
| Lint frontend | — | **Aucun linter configuré** (pas d'ESLint ni de Prettier, pas de script `lint`) | — |
| Lint/types Python | — | **Aucun outil configuré** (pas de `pyproject.toml`, ruff, mypy ni setup.cfg) | — |
| Docker | `docker compose config --quiet` | **OK** | — |
| Docker | `docker compose up -d --build`, `ps`, health | **Non exécuté** : démon Docker Desktop arrêté (`dockerDesktopLinuxEngine` introuvable) | README : 3 services healthy |
| E2E Chromium | `frontend/e2e/*.mjs` | **Non exécuté** (nécessite Docker et la stack démarrée) ; 9 parcours présents | Dossier : 8 ; README : 9 (+ `agents-smoke.mjs`) |
| CI | — | **Aucune** (pas de `.github/`) | — |

---

## 5. Dette technique, bugs probables, incohérences

### 5.1 Gestion de version (critique)
1. **Phases 4 à 5 non commitées** : environ 60 fichiers non suivis et 15 modifiés. Aucun tag. Le dépôt distant `origin/main` ne contient que la Phase 3.6.
2. **4.3.1 et 5 sont mélangées dans les mêmes fichiers** : `backend/app/main.py`, `backend/requirements.txt`/`.lock`, `frontend/src/App.tsx`, `README.md`, `backend/Dockerfile`, `frontend/e2e/Dockerfile`. Il n'existe **aucun snapshot exact de la 4.3.1** : `.artifacts/phase431-baseline` est l'état *avant* la 4.3.1. Un commit « 4.3.1 seule » demande un staging partiel soigneux.
3. Pas de `.gitattributes` : avertissements LF→CRLF sur chaque fichier, risque de diffs parasites.
4. `version="0.1.0"` inchangée (FastAPI et `package.json`) malgré 5 phases.

### 5.2 Bugs probables / points fragiles
1. **Assertion de revue côté client non vérifiable** : `agentSession.tsx` et le client de comparaison envoient toujours `candidate_confirmed: true` / `requirements_reviewed: true`. Le backend vérifie la cohérence des snapshots, pas l'identité du relecteur. C'est assumé et documenté (`unverified_client_assertion`), mais il faut le garder en tête pour toute exposition hors loopback.
2. **Sérialisation des démarrages de workflow** : `WorkflowManager.start()` appelle `cleanup()` en tenant `self.lock`, et `cleanup()` prend le verrou de *chaque* workflow. Un graphe en cours d'exécution bloque donc tous les démarrages et toutes les opérations qui prennent `self.lock`. C'est négligeable en local mono-utilisateur, gênant au-delà (`backend/app/agents/checkpoints.py:127-129`).
3. **État en mémoire du processus** : `WorkflowManager` dans `app.state`. Avec plusieurs workers uvicorn, ou après un redémarrage, les workflows sont introuvables (404). Comportement documenté, mais pas de garde-fou contre `--workers > 1`.
4. **`LOCAL_HOSTS` contient `testserver`** (hôte du TestClient) en production (`backend/app/agents/middleware.py:9`).
5. **Pas de borne de taille sur `/api/v1/jobs/*`** en accès direct sur le port 8000 : seul nginx limite à 6 MiB. Les bornes Pydantic limitent les champs, pas le corps JSON brut.
6. **Pas de vérification Host/Origin hors `/agents/`** : exposition théorique au DNS rebinding sur `/parse` (risque faible en loopback, mais pourrait déclencher un appel fournisseur LLM si `LLM_*` est configuré et que le formulaire envoie le consentement).
7. `langsmith` est importé directement (`checkpoints.py:20`) mais n'est pas déclaré dans `requirements.txt` (seulement transitif via `requirements.lock`).
8. `cancel()` accepte un workflow `blocked`/`failed` et le repasse en `cancelled`. Ce n'est pas dangereux mais l'erreur d'origine est perdue.

### 5.3 Code mort / redondances
- `agentApi.review()` et `agentApi.report()` (frontend) ne sont appelés nulle part hors tests ; les routes backend `/review` et `/report` ne servent qu'aux tests et à l'API.
- `.artifacts/phase*-baseline/` : copies complètes du code par phase (ignorées par Git mais encombrantes ; Git les rend inutiles une fois les commits faits).
- `frontend/tsconfig.tsbuildinfo` présent dans l'arborescence (ignoré).
- `App.tsx` (669 lignes) contient encore Dashboard, Candidates, CandidateDetail et Settings en ligne ; `JobAnalysis.tsx` fait 1 107 lignes. Candidats au découpage.
- `jobs.py` (563 lignes) : regex très denses (`PROTECTED`, `NEGATED_JOB`…), lignes de plus de 300 caractères ; difficile à relire sans linter ni formateur.

### 5.4 TODO/FIXME
Aucun `TODO`, `FIXME`, `XXX` ou `HACK` dans `backend/app`, `frontend/src`, `frontend/e2e`.

### 5.5 Incohérences docs ↔ code ↔ dossier
| Sujet | Dossier | README / docs | Code |
|---|---|---|---|
| Phase 5 | non confirmée | « Phases 1 through 5 are implemented » | implémentée ✅ (README juste) |
| Tests frontend | 74 | 90 | 90 cas statiques ✅ |
| E2E | 8 | 9 | 9 scripts ✅ |
| Postgres | présent | « application integration planned » | aucun ORM ni driver : juste |
| README commité | — | Le README de `HEAD` dit « matching and LangGraph agents remain planned » | ❌ obsolète sur `origin/main` |
| Compose | — | — | `db` exige `POSTGRES_*` (`:?`) alors que l'appli ne l'utilise pas : `docker compose up` échoue sans `.env` |

---

## 6. Risques de confidentialité et de sécurité

| Risque | Niveau | Constat |
|---|---|---|
| Secrets dans Git | ✅ faible | `.env` ignoré, absent de tout l'historique (`git log --all`). Seuls `.env.example` et `frontend/.env.example` sont suivis. `.env` local présent : **non lu**. |
| CV réels dans Git | ✅ faible | Aucun PDF ou DOCX suivi ni dans l'historique. Fixtures JSON avec domaines `example.*` uniquement (fictifs). |
| Données dans `.artifacts/` | ⚠️ à vérifier | Ignoré par Git, mais contient `phase5/live_api_workflow.json`, `phase431/reproduction.json` et des captures d'écran. Décrits comme fictifs dans les docs ; **non ouverts pendant l'audit**. À contrôler manuellement avant toute suppression de `.gitignore` ou tout partage du dossier. |
| `.gitignore` | ✅ | Couvre `.env*`, `*.pem`, `*.key`, `uploads/`, `uploaded_cvs/`, `cv_uploads/`, `data/cvs/`, `node_modules/`, caches Python, `dist/`, `.artifacts/`. **Manque** : `*.pdf` hors fixtures et un dossier type `samples/` ou `real_cvs/` ; aucune règle n'empêche de commiter un PDF posé à la racine ou dans `backend/tests/`. |
| Authentification | ⚠️ assumé | **Aucune** authentification. Mitigations : ports liés à `127.0.0.1`, CORS limité à `http://localhost:5173`, middleware Host/Origin local sur `/agents/`, capacité de session aléatoire de 256 bits (`X-Workflow-Session`, hachée en SHA-256 côté serveur, comparée en temps constant). **Ne pas exposer hors loopback en l'état.** |
| Persistance | ✅ | Aucune écriture disque ou DB des CV. Checkpoints en mémoire purgés aux états terminaux. `Cache-Control: no-store` partout (nginx + agents). |
| Fuite via erreurs | ✅ | Le handler 422 des agents n'écho pas les valeurs soumises. Les erreurs du graphe sont statiques (pas de `repr(error)`). |
| LLM externe | ✅ | Désactivé par défaut. Consentement par requête. `follow_redirects=False`. Consentement = champ de formulaire client (non prouvable, mais explicite dans l'UI). |
| Tracing tiers | ✅ | LangSmith désactivé explicitement autour de `graph.invoke`. |
| Postgres | ⚠️ | Mot de passe de `.env.example` décrit comme placeholder public ; pas de port publié. Le README rappelle de ne pas partager `docker compose config` (mots de passe résolus). |
| Dépendances | ⚠️ | Versions épinglées, mais aucun scan (pip-audit/npm audit) ni CI. |

---

## 7. État exact de la Phase 5

**Verdict : implémentation fonctionnelle, testée localement (649 tests backend verts), mais non commitée et non vérifiée en conteneur pendant cet audit.**

| Élément attendu | Présent | Détail |
|---|---|---|
| Dépendance LangGraph | ✅ | `langgraph==1.2.15` (+ `langgraph-checkpoint 4.3.0`, `langchain-core 1.6.11`, `langsmith 0.14.9` dans le lock et la venv) |
| `StateGraph` | ✅ | `backend/app/agents/graph.py:128` : 7 nœuds `intake_validation → candidate_preparation → job_preparation → evidence_comparison → evidence_verification → human_review → final_report`, arêtes conditionnelles stop/continue/retry |
| `interrupt` | ✅ | `graph.py:91` (`human()`), payload sans données candidat |
| `Command(resume=…)` | ✅ | `checkpoints.py:184`, avec `acknowledged`, `request_revision` et `snapshot_hash` revérifiés |
| Checkpointer | ✅ | `InMemorySaver` **par workflow**, `thread_id = workflow_id`, `recursion_limit 16`, `step_timeout 10`. Pas de checkpointer durable (Postgres/SQLite). |
| Retry borné | ✅ | 1 retry sur `TimeoutError`/`ConnectionError` dans `evidence_comparison` |
| Re-vérification | ✅ | `verify_evidence()` recalcule chaque ligne via `compare_requirement` et contrôle offsets, chemins, doublons et provenance technique, avant pause **et** après reprise |
| Routes start/status/resume/cancel/report | ✅ | + `/review` (voir §3.1) |
| Idempotence | ✅ | `client_request_id` (UUID) + empreinte ; 409 si réutilisé avec d'autres documents |
| Isolation | ✅ | Propriétaire = hash de la capacité de session ; 404 sinon |
| Cycle de vie | ✅ | TTL 30 min, 32 workflows max (éviction du plus ancien terminal, sinon 429), nettoyage toutes les 30 s, purge à l'arrêt |
| Page AI Agents | ✅ | `/agents` : prérequis, chronologie backend réelle, preuves via `ComparisonResults`, case d'accusé + « Review & Resume », annulation, rafraîchissement, invalidation si le profil ou l'offre change (annulation automatique du workflow en pause) |
| Tests | ✅ | 69 backend (`test_agents_graph.py` 35, `test_agents_api.py` 34) ; 16 frontend (`agents.test.tsx`, `agentsApi.test.ts`) ; E2E `agents-smoke.mjs` |
| Docs | ✅ | `docs/langgraph_architecture.md`, `docs/agent_workflow_testing.md` |

**Limites de la Phase 5** : orchestration *déterministe* (aucun agent LLM : le graphe enveloppe `compare_job` existant), revue humaine non authentifiée, pas d'historique ni d'audit durable, perte au redémarrage, mono-processus.

---

## 8. Plan de reprise proposé

Principe : de petites tâches, chacune vérifiable par une commande. Aucune ne démarre sans validation.

### Étape 0 — Sécuriser le travail existant (urgent, sans toucher au code)
| # | Tâche | Fichiers | Vérification |
|---|---|---|---|
| 0.1 | Créer une branche de sauvegarde avec **tout** l'état actuel (`wip/codex-snapshot-2026-11`), commit unique, push sur `origin`. | tout le working tree (hors ignorés) | `git status` propre sur la branche ; `git ls-remote` montre la branche |
| 0.2 | Contrôler manuellement `.artifacts/phase5/live_api_workflow.json` et `phase431/reproduction.json` (données fictives ?) | `.artifacts/` | inspection humaine |

### Étape 1 — Stabiliser et taguer la 4.3.1
| # | Tâche | Fichiers | Tests / vérification |
|---|---|---|---|
| 1.1 | Ajouter `.gitattributes` (`* text=auto eol=lf`, `*.png binary`, `*.pdf binary`) dans un commit séparé, puis renormaliser. | `.gitattributes` | `git diff` sans avertissements CRLF |
| 1.2 | Depuis `main`, nouvelle branche `release/4.3.1`. Stager **seulement** les fichiers Phase 4 → 4.3.1 : `models/job.py`, `services/jobs.py`, `job_formatting.py`, `job_vocabulary.py`, `routes/jobs.py`, `sections.py`, `multilingual.py`, `evaluate_*`, fixtures et tests jobs/comparison, `frontend/src/{jobApi,jobSession,jobTypes,comparison}.ts*`, `JobAnalysis.tsx`, `ComparisonResults.tsx`, CSS, tests associés, e2e 4.x, docs 4.x. | voir liste | — |
| 1.3 | Pour les fichiers mixtes (`main.py`, `App.tsx`, `requirements*.txt/.lock`, `README.md`, Dockerfiles, `api.ts`, `ReviewProfile.tsx`), staging partiel (`git add -p`) : exclure router/middleware agents, `langgraph`, route `/agents` (garder `ComingSoon`). | fichiers mixtes | `pytest` hors `test_agents_*` = **580 passés** ; `tsc --noEmit` = 0 ; vitest = **74** |
| 1.4 | Exécuter la suite dans Docker (`docker compose -f docker-compose.yml -f compose.test.yaml run --rm backend` + image test frontend) et les 8 E2E. | — | 580 / 74 / 8 |
| 1.5 | Passer la version à `0.4.3.1` dans `main.py` et `package.json` (en semver npm : `0.4.3-1` ou `0.4.31`, à trancher) ; commit, `git tag -a v0.4.3.1`, PR vers `main`. | `main.py`, `package.json` | tag visible, CI (si 2.x fait) verte |

*Alternative plus simple si le découpage s'avère trop risqué : commiter la 4.3.1 + 5 ensemble et taguer `v0.5.0-rc1`, en signalant dans le message que la 4.3.1 n'a pas de tag séparé.*

### Étape 2 — Outillage minimal (avant toute nouvelle fonctionnalité)
| # | Tâche | Fichiers | Vérification |
|---|---|---|---|
| 2.1 | Rendre les tests frontend lançables sur Windows : installer Node 22 LTS (décision utilisateur), puis `npm ci` local, **ou** documenter l'usage exclusif de Docker. | `README.md` | `npm test` = 74 (puis 90) |
| 2.2 | Ajouter ruff (lint + format check) en mode non bloquant, config minimale. | `backend/pyproject.toml`, `requirements-dev.txt` | `ruff check app tests` ; corriger les erreurs réelles seulement |
| 2.3 | Ajouter ESLint (typescript-eslint + react-hooks) + script `lint`. | `frontend/eslint.config.js`, `package.json` | `npm run lint` |
| 2.4 | CI GitHub Actions : pytest, `tsc -b`, vitest, `docker compose config --quiet` ; pas de secrets nécessaires. | `.github/workflows/ci.yml` | run vert sur PR |
| 2.5 | Déclarer `langsmith` dans `requirements.txt` (import direct). | `requirements.txt` | `pip check` dans l'image |

### Étape 3 — Intégrer la Phase 5 proprement
| # | Tâche | Fichiers | Tests à écrire / vérifier |
|---|---|---|---|
| 3.1 | Commit Phase 5 sur `feature/phase5-langgraph` depuis `v0.4.3.1` (reste du snapshot). | `app/agents/*`, `routes/agents.py`, frontend agents | 649 / 90 / 9 |
| 3.2 | Retirer `testserver` de `LOCAL_HOSTS` en prod (l'injecter via fixture de test). | `agents/middleware.py`, `tests/conftest.py` | test : Host `testserver` refusé hors mode test |
| 3.3 | Sortir `cleanup()` du verrou global dans `start()` (ou nettoyage non bloquant `try-acquire`). | `agents/checkpoints.py` | test de concurrence : un start pendant un graphe lent ne bloque pas |
| 3.4 | Garder l'erreur d'origine si `cancel` sur `blocked`/`failed` (ou renvoyer 409). | `agents/checkpoints.py` | test API |
| 3.5 | Décider du sort de `/review` et `/report` côté UI (les utiliser ou les documenter comme API seule). | `agentApi.ts`, docs | test UI si utilisés |
| 3.6 | Garde-fou démarrage : avertir si `WEB_CONCURRENCY`/workers > 1 (état en mémoire). | `main.py` | test unitaire du lifespan |
| 3.7 | Taguer `v0.5.0`. | — | Docker + 9 E2E verts |

### Étape 4 — Durcissement (après la 5)
| # | Tâche | Fichiers | Tests |
|---|---|---|---|
| 4.1 | Middleware Host-check global (DNS rebinding) + borne de corps pour `/api/v1/jobs/*`. | `main.py`, nouveau middleware | tests 403 / 413 |
| 4.2 | Rendre `db` optionnel (profil Compose `db`) tant que Postgres n'est pas utilisé. | `docker-compose.yml`, README | `docker compose up` sans `.env` Postgres |
| 4.3 | Découper `App.tsx` (pages Dashboard/Candidates/Settings) et `JobAnalysis.tsx`. | `frontend/src/pages/*` | vitest inchangé |
| 4.4 | `.gitignore` : ajouter `*.pdf` avec exception des fixtures générées, et `real_cvs/`. | `.gitignore` | `git check-ignore` |
| 4.5 | Mettre à jour le dossier de synthèse avec ce rapport. | docs | — |

---

## Annexe — Proposition de `CLAUDE.md` (non créé)

```markdown
# TalentFlow AI — instructions pour agents

Assistant de recrutement local-first fondé sur les preuves documentaires. React 19/TS/Vite → FastAPI/Pydantic →
services déterministes (PyMuPDF, analyse d'offre, comparaison par preuves) + LangGraph local (Phase 5).

## Commandes
### Backend (Python 3.11, venv dans backend/.venv)
- Tests : `cd backend && .venv/Scripts/python -m pytest -p no:cacheprovider -q`  (attendu : tous verts)
- Un fichier : `... -m pytest tests/test_jobs.py -q`
- Serveur : `cd backend && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000`
- Lint (quand configuré) : `ruff check app tests`

### Frontend (Node 22)
- `cd frontend && npm ci && npm test` (Vitest), `npx tsc --noEmit`, `npm run build`
- Note : node_modules installé dans Docker est Linux-only ; réinstaller avant usage sous Windows.

### Docker
- `docker compose config --quiet` (ne jamais afficher la config complète : mots de passe résolus)
- `docker compose up -d --build` puis `curl http://127.0.0.1:8000/api/v1/health`
- Tests backend conteneur : `docker compose -f docker-compose.yml -f compose.test.yaml run --rm backend`
- Ne JAMAIS lancer `docker compose down --volumes` ni un prune sans accord explicite.

## Conventions
- Routes sous `/api/v1`, schémas Pydantic `extra="forbid"`, erreurs `{"detail": {"code", "message"}}`.
- Toute preuve source garde des offsets exacts en points de code Unicode (slicing Python).
- Logique d'analyse déterministe dans `services/` ; le graphe `agents/` réutilise `compare_job` sans le dupliquer.
- Chaque changement de règle : test de régression + mise à jour des fixtures d'évaluation et de la doc `docs/`.
- Petits commits, branche par phase, tag par jalon (`vX.Y.Z`). Pas de commit sur `main` directement.

## Garde-fous métier (non négociables)
- Aucun score, pourcentage, classement ou tri de candidats. Statuts autorisés seulement :
  `documented`, `not_documented`, `needs_review`.
- Aucune décision ni recommandation automatique d'embauche ; « not documented » ≠ « incompétent ».
- Revue humaine obligatoire : la comparaison et le workflow restent bloqués tant que le profil CV ET les critères
  ne sont pas confirmés ; toute modification invalide les résultats précédents.
- Comparaison sur projection qualification seule : jamais identité, contact, employeur, lieu, dates, photo,
  âge, genre, nationalité ou autre caractéristique protégée.
- Aucun appel LLM/API externe sans configuration explicite ET consentement par requête. Tracing tiers désactivé.
- Aucune persistance de CV (ni disque, ni DB, ni localStorage) ; aucun log de contenu candidat.

## Données et secrets
- Ne jamais lire, afficher ni commiter `.env`, des clés, jetons ou CV réels. Fixtures = données fictives
  (domaines `example.*`) uniquement.
- Ne pas ouvrir `.artifacts/` sans raison ; ne jamais le commiter.
- Exposition réseau : loopback uniquement ; aucune authentification n'existe.
```
