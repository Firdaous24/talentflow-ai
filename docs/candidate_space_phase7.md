# Phase 7 — Espace candidat (v0.9.0)

Deuxième phase de la plateforme v1 ([V1_DESIGN.md](V1_DESIGN.md), §9). Un·e candidat·e dépose son CV en versions chiffrées, le revoit, colle des offres, en revoit les critères, puis lit une couverture documentaire et ses écarts. La démo `/api/v1` reste publique et sans compte.

## Démarrer en local

En plus de la phase 6 ([accounts_phase6.md](accounts_phase6.md)), `.env` doit contenir la clé maître de chiffrement :

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"   # → TALENTFLOW_DATA_KEY
```

- La clé fait 32 octets aléatoires, encodés en base64url. Le backend refuse une valeur absente, mal formée ou commençant par `change-me` : les routes CV répondent alors 503 `encryption_not_configured`, et le reste de `/api/v2` continue de fonctionner.
- Compose refuse de démarrer sans elle (`${TALENTFLOW_DATA_KEY:?…}`).
- **Perdre la clé rend tous les CV stockés illisibles** : sauvegardez-la séparément de la base. Si elle fuit, il faut la renouveler. La rotation (re-chiffrement des clés de données) n'est pas encore outillée ; elle est prévue en phase 11.
- `CV_ORIGINAL_STORAGE=disabled` (valeur par défaut) : seul le texte chiffré est conservé. `enabled` permet au candidat de demander, à chaque dépôt, la conservation du PDF original, chiffré lui aussi, dans le volume `cv_files` (`/data/cv_files`).

## Stockage chiffré (décision A3)

| Donnée | Où | Forme |
|---|---|---|
| Texte extrait du PDF | `cv_versions.extracted_text_enc` | AES-256-GCM |
| Résultat d'extraction (profil, avertissements, preuves) | `cv_versions.parsed_enc` | AES-256-GCM |
| Profil revu par le candidat | `cv_versions.reviewed_enc` | AES-256-GCM |
| Clé de données de la version | `cv_data_keys.wrapped_key` | Clé de 256 bits chiffrée par la clé maître |
| PDF original (option désactivée par défaut) | `/data/cv_files/<id de version>.bin` | AES-256-GCM, même clé de données |
| Offres collées | `job_offers` | En clair : texte public d'une offre, jamais le CV |

- **Une clé par version.** Chaque version de CV reçoit sa propre clé de données aléatoire, stockée chiffrée dans une table séparée.
- **Données associées.** Chaque valeur est scellée avec un contexte qui nomme la version et la colonne (`cv_version|<id>|parsed`). Copiée dans une autre ligne ou une autre colonne, elle ne se déchiffre plus.
- **Crypto-shredding.** Supprimer la ligne `cv_data_keys` rend illisibles toutes les copies restantes du chiffré : sauvegardes, fichiers oubliés.
- **Pas de contenu candidat en clair.** Aucune colonne, aucun journal et aucune entrée d'audit ne contient de contenu de CV : `cv.version_created` ne garde que le numéro de version.
- **Vérification par test.** Un test parcourt toutes les tables après un parcours complet et vérifie qu'aucun marqueur du CV fictif n'y figure en clair.

## Parcours et règles

1. **Dépôt.** `POST /api/v2/me/cv` (multipart, 5 Mio, 10 pages, mêmes contrôles que la démo).
   - L'extraction est déterministe et se fait pendant la requête. La file du worker arrive en phase 8 avec l'import en masse.
   - Chaque dépôt crée la version *n + 1* et n'écrase jamais l'ancienne, avec au plus 20 versions par profil.
   - Le débit est limité à 20 dépôts par minute et 100 par jour.
2. **Revue.** Seule la version actuelle (la plus récente) se revoit et se confirme ; les anciennes restent consultables mais verrouillées (409 `version_superseded`).
   - Enregistrer une revue annule la confirmation.
   - Confirmer exige d'avoir relu les avertissements (`warnings_acknowledged: true`).
3. **Diff.** `GET /me/cv/diff?from=&to=` compare deux versions, champ par champ et élément par élément.
   - La comparaison porte sur le profil revu s'il existe, sinon sur l'extraction.
4. **Offres.** `POST /me/targets` analyse une offre collée avec l'analyseur existant. L'offre reste privée au candidat.
   - La revue des critères applique les mêmes règles que la démo : un libellé corrigé doit rester justifié par le texte source (422 `unsupported_correction`).
   - Toute modification annule la confirmation.
5. **Couverture.** `GET /me/targets/{id}/coverage` exige la version actuelle confirmée **et** les critères confirmés. Sinon il répond 409, avec `cv_missing`, `cv_review_required` ou `criteria_review_required`.
   - Le calcul est `compare_job`, inchangé, sur la projection « qualification seule » du profil revu : ni identité, ni contact, ni employeur, ni lieu, ni dates.
   - **Décompte exact** : « x/y requis · a/b souhaités · n à interpréter ». Les clauses d'environnement technique sont affichées à titre d'information et ne sont jamais comptées.
   - Chaque nombre filtre la vue preuve côte à côte, avec l'extrait de l'offre à gauche et l'extrait du CV revu à droite, surligné à partir des offsets exacts.
   - Une mention permanente précise que la couverture n'évalue pas la compétence. Aucun score, pourcentage ni jauge n'est affiché.
6. **Écarts.** `GET /me/targets/{id}/gaps` ne renvoie que des clés fixes (`add_if_true`, `interpretation` et un motif) et la section du CV concernée.
   - L'interface affiche « Si c'est vrai, ajoutez-le avec un exemple vérifiable » et un lien vers cette section.
   - **Aucun texte n'est généré** à la place du candidat. Un test vérifie que chaque chaîne d'un écart est soit le libellé du critère, soit une clé fixe.
7. **Visibilité.** L'opt-in recruteur reste le consentement `recruiter_visibility` (`PUT /me/consents/recruiter_visibility`), désactivé par défaut et retiré immédiatement.
   - Aucune route recruteur n'expose un profil candidat, avec ou sans opt-in. La découverte arrive en phase 10.
8. **Export.** `GET /me/export` renvoie un JSON portable : compte, consentements, organisations, versions de CV déchiffrées (texte, extraction, profil revu, PDF en base64 s'il a été conservé) et offres.
   - L'export est journalisé (`account.exported`, sans contenu).
9. **Suppression.** `DELETE /me` efface l'utilisateur et, en cascade, le profil, les versions, les clés de données et les offres, puis supprime les fichiers.
   - Le worker balaie les fichiers orphelins de plus d'une heure.

## API ajoutée (`/api/v2`, rôle candidat sauf mention)

| Route | Rôle |
|---|---|
| `POST /me/cv` | Nouvelle version (multipart `file`, `keep_original`) |
| `GET /me/cv/versions` · `GET /me/cv/versions/{id}` | Historique · version (extraction et profil revu) |
| `GET /me/cv/versions/{id}/original` | PDF original, s'il a été conservé |
| `PUT /me/cv/versions/{id}/review` · `POST …/confirm` | Revue · confirmation |
| `GET /me/cv/diff?from=&to=` | Différences entre deux versions |
| `POST/GET /me/targets` · `GET/DELETE /me/targets/{id}` | Offres privées |
| `PUT /me/targets/{id}/requirements` · `POST …/confirm` | Revue et confirmation des critères |
| `GET /me/targets/{id}/coverage` · `…/gaps` | Couverture et écarts |
| `GET /me/export` | Export complet (tout rôle connecté) |
| `GET /candidate/overview` | Prochaine étape, version actuelle, offres, visibilité |

Toutes ces routes figurent dans la matrice générée [`test_v2_authorization.py`](../backend/tests/test_v2_authorization.py).
- Les routes `candidate:owned` répondent 404 pour l'identifiant d'un autre candidat, avec un corps identique à celui d'un identifiant inconnu.
- Un recruteur reçoit 403 `forbidden_role`.

## Interface

- L'espace candidat a trois onglets, **Aperçu**, **Mon CV** et **Mes offres**, sous `/account`, `/account/cv` et `/account/offers/:id`.
- Tous les textes passent par i18next (FR par défaut, EN), avec des propriétés CSS logiques et les tokens du design system.
- « Non documenté » est une absence neutre (gris, pointillés), jamais rouge.
- Les pages CV et offres sont chargées à la demande, ce qui garde le bundle principal sous 500 Ko.
- Le navigateur ne stocke rien. L'export passe par un lien temporaire.

## Écarts assumés par rapport au document de conception

| Point du document | Livré | Raison |
|---|---|---|
| « parsing asynchrone » du CV | Parsing synchrone dans la requête (limites inchangées) | La file Postgres et le worker de parsing arrivent en phase 8, avec l'import en masse. |
| `PUT /me/visibility` | Consentement `recruiter_visibility` existant | Une seule source de vérité pour l'opt-in, déjà retirable immédiatement. |
| Table `REQUIREMENT` | Critères revus en `JSONB` sur `job_offers` | Ce sont des offres privées du candidat ; la table viendra avec les offres d'organisation (phase 8). |
| Suppression du compte inactif après 12 mois, avec préavis | Non livrée | Rétention automatisée prévue en phase 11 (§9). |
| Rotation de la clé maître | Procédure non outillée | Phase 11 (durcissement). |

## Tests

| Niveau | Fichier | Contenu |
|---|---|---|
| Unitaire | `tests/test_v2_crypto.py` | Clé maître (format, placeholder), scellage et ouverture, liaison à la ligne et à la colonne, falsification, clés enveloppées, crypto-shredding |
| Unitaire | `tests/test_coverage.py` | Comptes exacts depuis `compare_job`, environnement technique non compté, classification revue, écarts à clés fixes, projection sans identité, diff |
| API | `tests/test_v2_candidate.py` | Deux revues avant couverture, invalidations, versions jamais écrasées, chiffré seul en base, PDF original désactivé ou chiffré, export complet, suppression (lignes, clés, fichiers), worker, 503 sans clé, visibilité |
| Autorisation | `tests/test_v2_authorization.py` | Nouvelles routes dans la matrice ; isolation entre candidats (404 identique) ; aucun contenu candidat via une route recruteur |
| Frontend | `src/test/candidate.test.tsx` | Parcours et export, dépôt, revue et confirmation, version ancienne en lecture seule, diff, couverture et écarts, blocages et invalidation, anglais |
| E2E | `e2e/candidate-smoke.mjs` | Parcours complet contre la stack : inscription, CV v1, offre, critères, couverture « 1/3 requis · 1/2 souhaités · 1 à interpréter », écarts, CV v2, diff, couverture « 2/3 requis », export, suppression |

```bash
# E2E candidat (stack Compose démarrée)
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local node candidate-smoke.mjs
```
