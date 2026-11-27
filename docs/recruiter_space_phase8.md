# Phase 8 — Espace recruteur (v0.10.0)

Troisième phase de la plateforme v1 ([V1_DESIGN.md](V1_DESIGN.md), §3.3 et §9). Un recruteur :
- crée des offres et en confirme les critères ;
- importe des CV en masse, après une attestation obligatoire ;
- revoit les profils importés ;
- lit un **classement anonyme par couverture documentaire** ;
- ouvre les preuves de chaque chiffre ;
- lève l'anonymat d'un profil, avec un motif journalisé.

Les candidat·es inscrit·es peuvent postuler aux offres publiques. La démo `/api/v1` reste publique et sans compte.

## Règles non négociables et leur mise en œuvre

| Règle | Où | Vérifiée par |
|---|---|---|
| Tri **lexicographique strict** : requis documentés ↓, puis souhaités documentés ↓, puis « à interpréter » ↑. Aucun poids ni score. | `app/services/ranking.py` | `tests/test_ranking.py` : tests de propriétés sur 700 jeux générés, comparés à une référence écrite indépendamment, avec invariance à l'ordre d'entrée |
| Ex æquo **groupés**, en ordre d'arrivée signalé « non significatif » | idem, puis `RankingGroup.tie_order` | API et E2E |
| Affichage « 5/6 requis · 2/3 souhaités · 1 à interpréter » ; chaque chiffre ouvre ses preuves côte à côte | `src/public/recruiter/Ranking.tsx` | vitest et E2E |
| Aucun score, pourcentage, jauge ni numéro de rang | contrats sans champ de ce type ; aucune balise `progress`/`meter` | API, vitest et E2E |
| **Anonymat par défaut** : nom, contact, ville, photo et dates masqués | Le classement, les preuves et la file « À revoir » n'exposent que la projection « qualifications ». L'identité n'existe que dans `Identity`, après une levée. | API (aucun marqueur d'identité dans le JSON), E2E (aucun dans le DOM) |
| Levée **volontaire, motivée, journalisée** | `POST …/matches/{id}/reveal` exige un motif (liste fermée) et une précision. L'audit `match.identity_revealed` ne garde que le motif, jamais l'identité ni la note. | API et E2E |
| Mention permanente **sous** le classement, et **aucune action automatique** | Mention affichée même si le classement est vide. Aucun seuil, rejet, acceptation ni e-mail : aucune route n'agit sur un rang. | vitest, E2E, API (aucun e-mail envoyé) |
| Import : **attestation obligatoire**, horodatée et journalisée | `ImportCreate.attestation: Literal[True]`. Sans elle : 422, et aucun lot n'est créé. Audit `import.attested`. | API et E2E (bouton bloqué sans la case) |
| Suppression **automatique à 90 jours** | Le worker supprime les profils importés expirés, avec leurs versions, leurs clés et leurs correspondances. | API (horloge simulée) |
| **Lien d'invitation** : revendiquer ou supprimer | Jeton haché, valable jusqu'à l'expiration du profil. Suppression sans compte, revendication avec un compte candidat. | API et E2E |
| Candidat inscrit visible **seulement avec le consentement** « visible par les recruteurs », retrait immédiat | Une seule règle SQL, `storage/matching.visible_profile()`, évaluée à chaque requête et jamais recopiée | API et E2E |
| **Isolation entre organisations** (404) | Toute route recruteur commence par le contrôle d'adhésion ; chaque ressource est filtrée par organisation. | Matrice générée : chaque route `recruiter:resource` testée via l'organisation de l'autre, via la sienne et avec un identifiant inconnu |
| **CV chiffrés** | Les PDF en file d'attente sont chiffrés avec leur propre clé, puis effacés une fois traités. Les profils importés passent par `storage/cv.py`. La comparaison stockée (`matches.comparison_enc`) est chiffrée avec la clé de la version ; seuls les comptes restent en clair. | API : aucun marqueur du CV en clair dans toute la base |

## Parcours recruteur

1. **Offre** : coller le texte, revoir et confirmer les critères (mêmes règles de correction que la démo).
   - L'offre ne s'ouvre qu'avec des critères confirmés, et ne devient publique qu'une fois ouverte.
   - Modifier les critères annule la confirmation, referme l'offre et met toutes les correspondances en recalcul.
2. **Import** : déclarer le lot (attestation, 200 fichiers au plus), puis envoyer chaque PDF dans sa propre requête (5 Mio).
   - L'API ne fait que mettre le fichier en file, chiffré.
   - Le **worker** le traite en arrière-plan : `FOR UPDATE SKIP LOCKED`, reprise des tâches bloquées, trois tentatives.
   - Les doublons sont repérés par un HMAC du fichier, propre à l'organisation.
   - Un lot de 200 fichiers est testé : 200 réponses 202 « queued », puis 200 profils analysés par le worker.
3. **À revoir** : chaque profil importé montre ses seules qualifications et ses avertissements. Le recruteur le confirme (après en avoir accusé lecture) ou le supprime.
   - Les profils non revus n'entrent jamais dans le classement.
4. **Classement** : les correspondances sont calculées par le worker avec `compare_job`, inchangé, sur la projection « qualifications ».
   - Alias stables par offre (« Candidat·e A-17 »).
   - Un clic sur un chiffre ouvre les preuves filtrées.
5. **Levée d'anonymat** : motif (entretien planifié, vérification des références, demande du candidat, autre) et précision obligatoires.
   - L'identité affichée se limite au nom et aux coordonnées.
6. **Invitation** : le recruteur génère un lien et le transmet lui-même. Aucun e-mail n'est envoyé.

## Parcours candidat

- **Postuler** à une offre publique exige un CV confirmé **et** le consentement `recruiter_visibility`, sinon la réponse est 409 `consent_required`.
  - Retirer ce consentement masque immédiatement toutes ses candidatures, sans attendre le worker.
- **Confirmer une nouvelle version** de CV la substitue dans toutes ses candidatures, qui sont recalculées.
- **Lien d'invitation** (`/claim?token=…`) :
  - « Supprimer mon profil maintenant » fonctionne sans compte ;
  - « Revendiquer » déplace les versions dans le compte candidat. Elles restent déchiffrables, mais redeviennent « à confirmer » par le candidat lui-même.
  - Une fois revendiqué, le profil suit la règle des inscrits : il n'est visible qu'avec le consentement.
- L'export de l'espace candidat inclut désormais les candidatures.

## API ajoutée (`/api/v2`)

| Route | Rôle |
|---|---|
| `POST/GET /orgs/{org}/jobs` · `GET/PATCH/DELETE /orgs/{org}/jobs/{job}` | Offres (statut `draft/open/closed`, visibilité `private/public`) |
| `PUT …/jobs/{job}/requirements` · `POST …/confirm` | Revue des critères |
| `POST/GET …/jobs/{job}/imports` · `POST /orgs/{org}/imports/{batch}/files` | Lot attesté, puis un fichier par requête |
| `GET …/jobs/{job}/review-queue` | Profils importés à revoir (qualifications seules) |
| `POST/DELETE /orgs/{org}/profiles/{profile}` (`/confirm`) · `POST …/invitation` | Revue, suppression, lien d'invitation |
| `GET …/jobs/{job}/ranking` · `GET /orgs/{org}/matches/{match}` · `POST …/reveal` | Classement anonyme, preuves, levée |
| `GET /me/public-jobs` · `POST/GET /me/applications` · `DELETE /me/applications/{id}` | Candidat : offres publiques et candidatures |
| `POST /claims/inspect` · `POST /claims/delete` (publics) · `POST /claims/accept` (candidat) | Lien d'invitation |

Migration `0003` (réversible) :
- `candidate_profiles` : profil `imported`, expiration, jeton d'invitation haché, contrainte de propriétaire unique ;
- nouvelles tables `import_batches`, `import_items` (la file) et `matches`.

Le `downgrade` supprime les profils importés et les offres d'organisation, qui n'existaient pas avant cette révision.

## Écarts assumés

| Point du document | Livré | Raison |
|---|---|---|
| Invitations de membres dans une organisation | Non livrées : une organisation par recruteur ; l'interface utilise la première | Pas de fournisseur d'e-mail (D8) et aucun flux d'invitation conçu ; à traiter avec le pipeline (phase 9). |
| Tests de propriétés avec Hypothesis | Générateur aléatoire **à graines fixes** (700 jeux), comparé à une référence indépendante | Mêmes propriétés vérifiées, sans nouvelle dépendance. |
| Revue « rapide » des profils importés | Confirmer ou supprimer, sans édition | Le candidat corrige lui-même après revendication. Le recruteur ne réécrit pas le CV d'autrui. |
| Visibilité §2.3 (candidature **ou** opt-in) | Plus strict : un inscrit n'est visible qu'avec le consentement, même s'il a postulé | Exigence explicite de la porteuse du projet (phase 8). |
| Un seul envoi multipart de 200 fichiers | Un lot déclaré, puis un fichier par requête | Garde la limite de 5 Mio par requête et une progression par fichier. |
| Pipeline Kanban, comparaison de deux candidats, export PDF | Non inclus | Phase 9. |
| Suppression des offres clôturées après 6 mois | Non livrée | Rétention automatisée en phase 11. |

## Tests

| Niveau | Fichier | Contenu |
|---|---|---|
| Unitaire | `tests/test_ranking.py` | Ordre lexicographique strict, groupes d'ex æquo, ordre d'arrivée, invariance à l'ordre d'entrée (propriétés sur données générées) |
| API | `tests/test_v2_recruiter.py` | Attestation obligatoire et journalisée, file et worker, doublons, anonymat (file, classement, preuves), levée motivée et audit, invalidation par les critères, consentement des inscrits, lien d'invitation (suppression, revendication), expiration à 90 jours, lot de 200 fichiers, limites |
| Autorisation | `tests/test_v2_authorization.py` | Toutes les nouvelles routes classées ; isolation `recruiter:resource` sur chaque ressource imbriquée ; candidatures isolées entre candidats |
| Frontend | `src/test/recruiter.test.tsx` | Classement anonyme (groupes, comptes, mention sous la liste, aucun score), preuves et levée motivée, import bloqué sans attestation, revue, consentement requis pour postuler, page d'invitation |
| E2E | `e2e/recruiter-smoke.mjs` | Offre, import attesté de 10 PDF générés, revue, classement trié et anonyme, preuves, levée, suppression par le lien, candidature visible puis masquée au retrait du consentement, nettoyage des comptes |
