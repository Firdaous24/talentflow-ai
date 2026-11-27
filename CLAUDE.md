# TalentFlow AI — guide pour agents

Assistant de recrutement local-first fondé sur les preuves documentaires, la revue humaine et la traçabilité.
React 19 / TypeScript / Vite → FastAPI / Pydantic → services déterministes (PyMuPDF, analyse d'offre FR/EN,
comparaison par preuves) + orchestration LangGraph locale avec interrupt/resume (Phase 5, tag `v0.5.0`).
PostgreSQL est disponible en profil Compose optionnel `db` mais **pas encore utilisé** par l'application.

## Commandes validées sous Windows (Git Bash)

Node.js est installé dans `C:\Program Files\nodejs` ; si `node` est introuvable dans une session déjà ouverte,
préfixer avec `export PATH="/c/Program Files/nodejs:$PATH" &&`. Enchaîner les commandes dépendantes avec `&&`.

### Backend (Python 3.11, venv `backend/.venv`)
- Tests : `cd backend && PYTHONDONTWRITEBYTECODE=1 .venv/Scripts/python.exe -m pytest -p no:cacheprovider -q`
  (référence `v0.5.0` : **649 passés**)
- Un fichier : `... -m pytest -p no:cacheprovider -q tests/test_jobs.py`
- Serveur local : `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000`
- Lint/types Python : non configurés pour l'instant.

### Frontend (`frontend/`)
- Installation : `npm ci` (le `node_modules` doit être installé avec le Node Windows, pas dans Docker)
- Tests : `npx vitest run` (référence : **90 passés**, 9 fichiers)
- Types : `npx tsc --noEmit` (0 erreur attendue, mode strict)
- Build : `npm run build`
- Lint : pas d'ESLint configuré pour l'instant.

### Docker
- Valider : `docker compose config --quiet` (ne jamais afficher la config complète : mots de passe résolus)
- Démarrer : `docker compose up -d --build --wait` (frontend + backend seulement, `.env` non requis), puis
  `curl http://127.0.0.1:8000/api/v1/health` et http://localhost:5173. Les ports 127.0.0.1:8000 et :5173 doivent être libres.
- Postgres (optionnel) : `docker compose --profile db up -d --wait` (valeurs `POSTGRES_*` dans `.env`).
  Le volume `postgres_data` ne doit jamais être supprimé.
- Tests backend conteneur : `docker compose -f docker-compose.yml -f compose.test.yaml run --rm backend`
- Tests frontend conteneur : `docker build --target test -t talentflow-ai-frontend-test:local frontend && docker run --rm talentflow-ai-frontend-test:local npm test`
- E2E Chromium (9 scripts) : voir `docs/agent_workflow_testing.md` (certains scripts exigent un montage `/fixtures`).
- **Interdit sans accord explicite** : `docker compose down --volumes`, tout `prune`, toute suppression de volume.

## Pièges connus
- `core.autocrlf=true` sur ce poste ; `.gitattributes` impose LF. Des fixtures sont figées par hash SHA-256 des
  octets bruts (`test_comparison_accuracy_corpus_is_frozen_and_independent`) : une copie en CRLF fait échouer ce
  test sans que le contenu commité soit en cause. Vérifier avec `git ls-files --eol`.
- Les workflows LangGraph vivent en mémoire du processus : un seul worker uvicorn, perte au redémarrage.
- Node local (v26) ≠ image Docker (`node:22-alpine`) ; en cas d'écart de comportement, la référence est Docker.

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
- Aucune persistance de CV (disque, base, localStorage) ; aucun log de contenu candidat.

## Données et secrets
- Ne jamais lire, afficher ni commiter `.env`, clés, jetons ou CV réels. Fixtures : données fictives uniquement
  (domaines `example.*`).
- `.artifacts/` est ignoré : ne pas le commiter ni l'ouvrir sans raison.
- Exposition réseau : loopback uniquement ; aucune authentification n'existe.
