# Phase 6 — Comptes, rôles et PostgreSQL (v0.8.0)

Première phase de la plateforme v1 ([V1_DESIGN.md](V1_DESIGN.md), §9). Elle livre les fondations : base obligatoire, comptes à rôle, sessions, consentements et pages publiques. La démo `/api/v1` reste publique et sans compte.

## Démarrer en local

1. Copier `.env.example` en `.env`, puis générer le secret :
   `python -c "import secrets; print(secrets.token_urlsafe(48))"` → `TALENTFLOW_SECRET_KEY`.
   Le backend refuse toute valeur de moins de 32 caractères ou commençant par `change-me`.
2. `docker compose up -d --build --wait`. Services lancés :
   - `db` ;
   - `migrate` (exécute `alembic upgrade head` puis s'arrête) ;
   - `backend` ;
   - `worker` ;
   - `mailpit` ;
   - `frontend`.
3. Les pages publiques :
   - accueil : http://localhost:5173/welcome ;
   - démo : http://localhost:5173/ ;
   - e-mails capturés : http://localhost:8025 (Mailpit, aucun envoi externe).

`SESSION_COOKIE_SECURE=false` n'est valable qu'en HTTP local (Compose). En ligne, le cookie reste `Secure` et porte le préfixe `__Host-`.

## API `/api/v2`

| Route | Accès | Rôle |
|---|---|---|
| `GET /auth/csrf` | public | Jeton CSRF (double soumission signée, lié à la session) |
| `POST /auth/register` | public | Inscription `{email, password, role, locale, accept_terms, marketing}` ; 202 identique que l'adresse existe ou non |
| `POST /auth/verify-email` · `/verify-email/resend` | public | Jeton à usage unique, haché, 24 h |
| `POST /auth/login` | public | Session côté serveur, rotation de l'identifiant ; refusée tant que l'e-mail n'est pas vérifié |
| `POST /auth/password/forgot` · `/password/reset` | public | Jeton de 30 min ; la réinitialisation ferme toutes les sessions |
| `POST /auth/logout` · `GET /auth/me` | connecté | Révocation immédiate en base |
| `PATCH /me` · `DELETE /me` | connecté | Langue ; suppression du compte (mot de passe exigé) |
| `GET /me/consents` · `PUT /me/consents/{purpose}` | connecté | Consentements séparés, datés, versionnés, retirables |
| `POST/GET /orgs` · `GET /orgs/{id}` · `/orgs/{id}/members` | recruteur | Organisations minimales, filtrées par adhésion |
| `GET /candidate/overview` | candidat | Espace candidat (les CV arrivent en phase 7) |

Erreurs au format `{"detail": {"code", "message"}}` :

| Code | Statut | Cas |
|---|---|---|
| `not_authenticated` | 401 | Pas de session valide |
| `csrf_failed` | 403 | Méthode non sûre sans jeton CSRF valide |
| `forbidden_role` | 403 | La route est réservée à un autre rôle |
| `not_found` | 404 | Ressource d'une autre organisation, ou inexistante (même réponse) |
| `invalid_credentials` | 401 | Identifiants refusés, sans distinguer e-mail inconnu et mauvais mot de passe |
| `email_not_verified` | 403 | Connexion avant vérification de l'e-mail |
| `too_many_attempts` | 429 | Limite atteinte, avec l'en-tête `Retry-After` |
| `validation_error` | 422 | Champs invalides ; les valeurs soumises ne sont jamais renvoyées |
| `service_not_configured` | 503 | Variables d'environnement absentes ou dangereuses ; `/api/v1` continue de répondre |

## Sécurité

- **Mots de passe** :
  - argon2id (m = 19 Mio, t = 2, p = 1), re-hash transparent si les paramètres changent ;
  - 12 à 128 caractères, sans règle de composition.
- **Sessions** :
  - jeton aléatoire de 256 bits, dont seul le SHA-256 est stocké en base ;
  - expiration absolue de 7 jours, inactivité de 12 h ;
  - cookie `HttpOnly`, `SameSite=Lax`, `Secure` et préfixé `__Host-` par défaut.
- **CSRF** :
  - le jeton vaut HMAC(secret, graine du cookie CSRF `SameSite=Strict` + empreinte de la session) ;
  - une connexion change donc le jeton ;
  - vérifié par un middleware avant tout code de route.
- **Limites de débit** (en mémoire, un seul worker uvicorn, décision D16) :
  - échecs de connexion : 5 par minute et 20 par heure par compte ;
  - tentatives de connexion : 30 par minute par client ;
  - inscriptions : 10 par heure par client ;
  - e-mails : 3 par heure par adresse.
- **Énumération** : inscription, renvoi et oubli de mot de passe répondent 202 de façon identique. Une inscription sur une adresse existante envoie un e-mail d'avertissement au titulaire.
- **Frontière locale** : le contrôle `Host`/`Origin` et la limite JSON de 1 Mio s'appliquent aussi à `/api/v2`. Un nom d'hôte en ligne ne s'ajoute qu'explicitement, via `TALENTFLOW_ALLOWED_HOSTS`.
- **En-têtes** :
  - `/api/v2` : `no-store`, `no-referrer`, `nosniff`, `DENY` ;
  - frontend : CSP stricte (`script-src 'self'` ; l'initialisation du thème est un fichier `/theme-init.js`), `X-Frame-Options`, `Permissions-Policy` et `Cross-Origin-Opener-Policy`.
- **Journal d'audit** :
  - acteur pseudonymisé par HMAC, sans e-mail, mot de passe ni contenu ;
  - un déclencheur PostgreSQL interdit `UPDATE` et n'autorise `DELETE` qu'au-delà de 12 mois (rétention A3).
- **Suppression du compte** :
  - mot de passe exigé ;
  - efface l'utilisateur, ses sessions, jetons, consentements et adhésions ;
  - une organisation sans autre membre est supprimée ; sinon la propriété passe au membre suivant ;
  - il ne reste qu'une entrée d'audit `account.deleted` pseudonymisée.

## Worker

`python -m app.worker` effectue une passe de rétention toutes les heures (`WORKER_INTERVAL_SECONDS`) :
- sessions expirées ou inactives ;
- jetons d'e-mail expirés, ou utilisés depuis plus d'un jour ;
- entrées d'audit de plus de 12 mois.

Seuls des compteurs sont journalisés. La file d'import arrive en phase 8.

## Tests

| Niveau | Fichier | Contenu |
|---|---|---|
| Unitaire | `tests/test_v2_security.py` | argon2 et re-hash, jetons, CSRF, pseudonymes, limiteur (horloge simulée), configuration, UUID v7, middleware CSRF, frontière locale, 503 sans configuration |
| Migrations | `tests/test_v2_migrations.py` | `upgrade` → `downgrade` → `upgrade`, absence de dérive modèles/migration, audit en ajout seul, contraintes |
| API | `tests/test_v2_auth.py` | Parcours complet, cookie, énumération, jetons expirés ou réutilisés, session volée après déconnexion, rotation, inactivité, CSRF lié à la session, verrouillage, réinitialisation, consentements, suppression |
| Autorisation | `tests/test_v2_authorization.py` | Matrice générée à partir de l'OpenAPI : chaque opération doit avoir une politique ; anonyme → 401, mauvais rôle → 403, autre organisation → 404, sans CSRF → 403 |
| Worker | `tests/test_v2_worker.py` | Purges de rétention |
| Frontend | `src/test/auth.test.tsx` | Accueil et avertissement, choix du rôle, validation et envoi de l'inscription, erreurs de connexion, espaces candidat et recruteur, déconnexion, suppression, langue, absence d'appel `/api/v2` dans la démo |
| E2E | `e2e/auth-smoke.mjs` | Candidat FR et recruteur EN : inscription, vérification via Mailpit, connexion, cookie `HttpOnly`, révocation, CSRF, isolation des rôles, suppression ; CSP sans violation ; démo sans compte |

Les tests qui utilisent la base demandent `TEST_DATABASE_URL`, qui doit pointer vers une base **jetable** : les fixtures la migrent et la vident.
- Sans cette variable, ils sont ignorés en local.
- En CI, `REQUIRE_DATABASE_TESTS=1` interdit qu'ils soient ignorés.
- `compose.test.yaml` fournit un service `test-db` en tmpfs, distinct de `postgres_data`.

```bash
# Base de test jetable (aucun volume nommé), puis tests backend
docker run -d --rm --name tf-test-pg -p 127.0.0.1:55432:5432 -e POSTGRES_DB=talentflow_test \
  -e POSTGRES_USER=talentflow_test -e POSTGRES_PASSWORD=test-only-local postgres:17.11-bookworm
cd backend && TEST_DATABASE_URL=postgresql+psycopg://talentflow_test:test-only-local@127.0.0.1:55432/talentflow_test \
  .venv/Scripts/python.exe -m pytest -p no:cacheprovider -q

# E2E comptes (stack Compose démarrée)
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local node auth-smoke.mjs
```
