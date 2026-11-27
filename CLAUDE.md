# TalentFlow AI — guide pour agents

Assistant de recrutement local-first fondé sur les preuves documentaires, la revue humaine et la traçabilité.
React 19 / TypeScript / Vite → FastAPI / Pydantic → services déterministes (PyMuPDF, analyse d'offre FR/EN,
comparaison par preuves) + orchestration LangGraph locale avec interrupt/resume (Phase 5). Dernier jalon : `v0.8.0` (comptes et rôles, PostgreSQL obligatoire).
Plateforme v1 en cours ([docs/V1_DESIGN.md](docs/V1_DESIGN.md), décisions §11) : la phase 6 (`v0.8.0`, fusionnée) rend
**PostgreSQL obligatoire** (SQLAlchemy 2 + Alembic) et ajoute les comptes à rôle sous `/api/v2` ([docs/accounts_phase6.md](docs/accounts_phase6.md)) ;
la phase 7 (`v0.9.0`, branche `feat/v1-phase7`) ajoute l'espace candidat : CV versionnés **chiffrés**, offres, couverture et écarts
([docs/candidate_space_phase7.md](docs/candidate_space_phase7.md)).
`/api/v1` reste la démo publique, sans compte.

## Commandes validées sous Windows (Git Bash)

Node.js est installé dans `C:\Program Files\nodejs` ; si `node` est introuvable dans une session déjà ouverte,
préfixer avec `export PATH="/c/Program Files/nodejs:$PATH" &&`. Enchaîner les commandes dépendantes avec `&&`.

### Backend (Python 3.11, venv `backend/.venv`)
- Tests : `cd backend && PYTHONDONTWRITEBYTECODE=1 .venv/Scripts/python.exe -m pytest -p no:cacheprovider -q`
  (référence phase 7 : **849 passés** avec `TEST_DATABASE_URL` ; sans elle, 712 passent et les 137 tests sur base sont ignorés).
  `TEST_DATABASE_URL` doit viser une base **jetable** (les fixtures font `downgrade base` puis `TRUNCATE`) : jamais la base Compose.
  Exemple : `docker run -d --rm --name tf-test-pg -p 127.0.0.1:55432:5432 -e POSTGRES_DB=talentflow_test -e POSTGRES_USER=talentflow_test -e POSTGRES_PASSWORD=test-only-local postgres:17.11-bookworm`
- Migrations : `.venv/Scripts/python.exe -m alembic upgrade head` (URL via `DATABASE_URL` ou `POSTGRES_*`) ; toute migration est réversible
  et vérifiée en CI (`upgrade` → `downgrade base` → `upgrade` → `alembic check`).
- Un fichier : `... -m pytest -p no:cacheprovider -q tests/test_jobs.py`
- Serveur local : `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000`
- Lint : `.venv/Scripts/python.exe -m ruff check app tests migrations *.py` (config `backend/ruff.toml`, outils dev dans
  `requirements-dev.txt`). Pas de reformatage massif : corriger, ou ignorer de façon ciblée et justifiée.
- Pas de vérification de types Python (mypy non configuré).

### Frontend (`frontend/`)
- Installation : `npm ci` (le `node_modules` doit être installé avec le Node Windows, pas dans Docker)
- Tests : `npx vitest run` (référence : **109 passés**, 12 fichiers). Node local = **22 LTS** (winget `OpenJS.NodeJS.22`), comme l'image Docker.
  **Lancer depuis un chemin en `C:` majuscule** (`cd "C:/Users/MSI/Desktop/talentflow-ai/frontend"`) : si le dossier courant s'écrit `c:`
  en minuscule (terminal VS Code), vitest charge deux instances et échoue au chargement (« failed to find the current suite »),
  quelle que soit la version de Node. En cas de doute, l'image Docker fait référence : `docker build --target test -t talentflow-ai-frontend-test:local frontend && docker run --rm talentflow-ai-frontend-test:local npx vitest run`.
- Types : `npx tsc --noEmit` (0 erreur attendue, mode strict)
- Build : `npm run build`
- Lint : `npm run lint` (ESLint flat config, typescript-eslint, règles react-hooks classiques ; 0 erreur attendue).

### Docker
- Valider : `docker compose config --quiet` (ne jamais afficher la config complète : mots de passe résolus)
- Démarrer : `docker compose up -d --build --wait` (db, migrate, backend, worker, mailpit, frontend). `.env` est **requis**
  (`POSTGRES_*`, `TALENTFLOW_SECRET_KEY` et `TALENTFLOW_DATA_KEY` générés, `SESSION_COOKIE_SECURE=false` en HTTP local) ; ne jamais le lire ni l'afficher.
  Pour ajouter des clés sans toucher `.env` : `--env-file .env --env-file <fichier hors dépôt>`.
  Puis `curl http://127.0.0.1:8000/api/v1/health`, http://localhost:5173 (démo), /welcome (accueil public), http://localhost:8025 (Mailpit).
  Les ports 127.0.0.1:8000, :5173 et :8025 doivent être libres. Le volume `postgres_data` ne doit jamais être supprimé.
- Tests backend conteneur : `docker compose -f docker-compose.yml -f compose.test.yaml run --rm backend` (base `test-db` en tmpfs, distincte de `postgres_data`)
- Tests frontend conteneur : `docker build --target test -t talentflow-ai-frontend-test:local frontend && docker run --rm talentflow-ai-frontend-test:local npm test`
- E2E Chromium (12 scripts, dont `demo-smoke.mjs`, `auth-smoke.mjs` et `candidate-smoke.mjs`) : voir `docs/agent_workflow_testing.md` (certains scripts exigent
  un montage `/fixtures` ; `comparison-workflow-smoke.mjs` avec `-e NATIVE_MOUSE=1`). `auth-smoke.mjs` lit les e-mails dans Mailpit.
  Captures : `screenshots-phase6.mjs` (écrans publics) et `screenshots-phase7.mjs` (espace candidat) avec `-v <dossier>:/out`.
  Sous Git Bash, préfixer `MSYS_NO_PATHCONV=1` dès qu'un argument est un chemin Linux (`-v …:/out`, `--build-arg LOCK_FILE=/dev/null`).
- **Interdit sans accord explicite** : `docker compose down --volumes`, tout `prune`, toute suppression de volume.

## CI
- `.github/workflows/ci.yml` (push sur toute branche et PR sur `main`) : backend (service Postgres jetable, ruff, migrations
  réversibles, pytest avec `REQUIRE_DATABASE_TESTS=1`, install contrainte par `requirements.lock`), frontend (Node 22 : lint, tsc, vitest, build), compose (`config --quiet` avec un `.env`
  généré depuis `.env.example`). Aucun secret, aucun déploiement. Suivi : `gh run list` / `gh run watch`.

## Sécurité réseau
- Toutes les routes `/api/v1` et `/api/v2` refusent un `Host`/`Origin` non local (403 `local_requests_only`) et limitent le
  corps JSON à 1 MiB ; l'upload CV reste à 5 MiB, les workflows agents à 512 KiB. Hôtes supplémentaires : `TALENTFLOW_ALLOWED_HOSTS` uniquement.
- `/api/v2` : session par cookie `HttpOnly` (`__Host-`/`Secure` par défaut), CSRF obligatoire sur toute méthode non sûre (403 `csrf_failed`),
  401 sans session, 403 `forbidden_role`, 404 pour une autre organisation ou la ressource d'un autre candidat. Toute nouvelle route doit être classée dans la matrice
  `backend/tests/test_v2_authorization.py` (sinon le test échoue). Les tests utilisent
  `TestClient(app, base_url="http://localhost")` : ne jamais réintroduire `testserver` dans les hôtes autorisés.

## Design system (frontend)
- Toutes les valeurs (couleurs, tailles, espacements, rayons, ombres, durées) viennent de `src/theme/tokens.css` ;
  aucune couleur en dur ailleurs. Polices via `@fontsource` uniquement, aucun CDN.
- `not_documented` est une absence neutre (gris, marqueur en pointillés), jamais rouge ; le rouge est réservé aux erreurs système.
- Ne jamais changer un nom accessible, label ou texte utilisé par les tests ; les E2E lisent les blockquotes de preuve
  (le passage surligné doit rester le seul texte de la citation) et les compteurs (valeur finale toujours dans le DOM).
- Respecter `prefers-reduced-motion` ; le stockage navigateur n'est écrit que sur action explicite (thème, langue).
- Pages publiques et espaces connectés (`src/public/`) : aucun texte en dur, tout passe par i18next (`src/i18n/fr.ts` par défaut,
  `en.ts` typé à l'identique) et les propriétés CSS logiques (RTL prévu). L'atelier démo reste en anglais : les E2E lisent ses libellés.
- L'atelier démo n'appelle jamais `/api/v2` (`AuthProvider` n'est monté que sous les chemins publics, cf. `isPublicPath`).

## Pièges connus
- `core.autocrlf=true` sur ce poste ; `.gitattributes` impose LF. Des fixtures sont figées par hash SHA-256 des
  octets bruts (`test_comparison_accuracy_corpus_is_frozen_and_independent`) : une copie en CRLF fait échouer ce
  test sans que le contenu commité soit en cause. Vérifier avec `git ls-files --eol`.
- Les workflows LangGraph vivent en mémoire du processus : un seul worker uvicorn, perte au redémarrage.
- Node local (22 LTS, Windows) et image Docker (`node:22-alpine`) ont la même version majeure ; en cas d'écart de comportement, la référence est Docker.

## Conventions
- Routes sous `/api/v1` ; schémas Pydantic hérités de `Schema` (`extra="forbid"`) ;
  erreurs au format `{"detail": {"code": ..., "message": ...}}`.
- Les preuves source gardent des offsets exacts en points de code Unicode (slicing Python).
- Logique métier déterministe dans `backend/app/services/` ; `backend/app/agents/` réutilise `compare_job`
  sans dupliquer ses règles.
- Toute modification de règle : test de régression + mise à jour des fixtures/évaluations concernées + doc dans `docs/`.
  Ne jamais ré-étiqueter une fixture figée pour faire passer un test.
- Git : Conventional Commits, une branche par chantier, tag par jalon (`vX.Y.Z`), pas de push sans accord.

## Garde-fous métier (non négociables)
- Aucun score, pourcentage, classement ou tri de candidats. Statuts autorisés uniquement :
  `documented`, `not_documented`, `needs_review`. « Non documenté » ne signifie pas « incompétent ».
- Aucune décision ni recommandation automatique d'embauche.
- Revue humaine obligatoire : comparaison et workflow bloqués tant que le profil CV **et** les critères de
  l'offre ne sont pas confirmés ; toute modification invalide les résultats et accusés précédents.
- Comparaison sur projection « qualification seule » : jamais identité, contact, employeur, lieu, dates,
  photo ni caractéristique protégée (âge, genre, nationalité, santé, situation familiale…).
- Aucun appel LLM ou API externe sans configuration explicite (`LLM_*`) **et** consentement par requête ;
  tracing tiers (LangSmith) désactivé.
- CV persistés **uniquement chiffrés** (AES-256-GCM, une clé de données par version, enveloppée par `TALENTFLOW_DATA_KEY`) ; PDF original
  désactivé par défaut (`CV_ORIGINAL_STORAGE`) ; jamais de contenu de CV en clair en base, sur disque, dans le navigateur, les logs ou l'audit.
  Tout code qui lit ou écrit un CV passe par `backend/app/storage/cv.py`.
- Marché v1 : Maroc uniquement (loi 09-08) ; toute instance en ligne est une démo avec avertissement visible. Rétention : V1_DESIGN §5.4.
- Journal d'audit : en ajout seul (déclencheur PostgreSQL), acteur pseudonymisé, jamais d'e-mail, de mot de passe ni de contenu.

## Données et secrets
- Ne jamais lire, afficher ni commiter `.env`, clés, jetons ou CV réels. Aucun secret par défaut dans le code : tout passe par l'environnement. Fixtures : données fictives uniquement
  (domaines `example.*`).
- `.artifacts/` est ignoré : ne pas le commiter ni l'ouvrir sans raison.
- Exposition réseau : loopback uniquement ; `/api/v1` (démo) est sans authentification, `/api/v2` exige une session.
