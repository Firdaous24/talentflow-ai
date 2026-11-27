"""Recruiter space API (phase 8): bulk import with attestation, review queue, anonymous
lexicographic ranking, reasoned reveal, consent-gated applications, claim links and expiry."""

import json
from datetime import timedelta

import pytest
from conftest import SYNTHETIC_CVS, make_pdf, new_v2_client
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from v2_helpers import csrf, fictional_cv, import_files, login, recruiter_job, run_worker, sign_up, unsafe, upload_cv

from app.auth import mailer
from app.db.models import utcnow
from app.worker import run_once

IDENTITY_MARKERS = ["Imported Person", "@example.com", "+212", "Fictional College", "2019", "2022"]
# A: 2/3 required, 1/2 preferred; C ties with A; D: 1/3, 1/2; B: 1/3, 0/2. Everyone: 1 to interpret (language level).
SKILLS = {1: ["Python", "Docker", "FastAPI"], 2: ["Python"], 3: ["Python", "Docker", "FastAPI"], 4: ["Docker", "Kubernetes"]}


def sql(url: str, statement: str, **params):
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            return connection.execute(text(statement), params).all()
    finally:
        engine.dispose()


def database_dump(url: str) -> str:
    engine = create_engine(url)
    with engine.connect() as connection:
        tables = connection.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).all()
        dump = "\n".join(str(row) for table in tables for row in connection.execute(text(f'SELECT * FROM "{table}"')).all())
    engine.dispose()
    return dump


@pytest.fixture
def recruiter(v2_client):
    org, job = recruiter_job(v2_client, "recruiter@example.com")
    return v2_client, org, job


def imported_and_confirmed(client, org, job, url, numbers=(1, 2, 3, 4)):
    _, responses = import_files(client, org, job, [make_pdf(fictional_cv(number, SKILLS[number])) for number in numbers])
    assert [response.status_code for response in responses] == [202] * len(numbers)
    assert run_worker(url)["files"] == len(numbers)
    queue = client.get(f"/api/v2/orgs/{org}/jobs/{job}/review-queue").json()
    for item in queue:
        assert unsafe(client, "POST", f"/api/v2/orgs/{org}/profiles/{item['profile_id']}/confirm", {"warnings_acknowledged": True}).status_code == 201
    run_worker(url)
    return queue


def test_import_requires_the_recruiters_attestation_and_audits_it(recruiter, v2_env):
    client, org, job = recruiter
    for body in ({"file_count": 2}, {"attestation": False, "file_count": 2}):
        refused = unsafe(client, "POST", f"/api/v2/orgs/{org}/jobs/{job}/imports", body)
        assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "validation_error")
    batch = unsafe(client, "POST", f"/api/v2/orgs/{org}/jobs/{job}/imports", {"attestation": True, "file_count": 2}).json()
    assert batch["attestation_version"] == "2026-11-27" and batch["attested_at"]
    assert batch["expires_at"].startswith((utcnow() + timedelta(days=90)).date().isoformat())
    [(actor, details)] = sql(v2_env, "SELECT actor_ref, details FROM audit_log WHERE action = 'import.attested'")
    assert actor and details["file_count"] == 2
    assert sql(v2_env, "SELECT attested_by IS NOT NULL, attested_at IS NOT NULL FROM import_batches") == [(True, True)]


def test_import_review_anonymous_ranking_and_reasoned_reveal(recruiter, v2_env):
    client, org, job = recruiter
    pdfs = [make_pdf(fictional_cv(number, SKILLS[number])) for number in (1, 2, 3, 4)]
    batch, responses = import_files(client, org, job, [*pdfs, pdfs[0]])
    assert [response.json()["status"] for response in responses] == ["queued", "queued", "queued", "queued", "duplicate"]
    not_pdf = client.post(f"/api/v2/orgs/{org}/imports/{batch}/files", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}, headers={"X-CSRF-Token": csrf(client)})
    assert not_pdf.status_code == 415
    # The API only queued the files: nothing is parsed until the worker runs.
    assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/review-queue").json() == []
    assert sql(v2_env, "SELECT count(*) FROM import_items WHERE pdf_enc IS NOT NULL") == [(4,)]
    assert run_worker(v2_env)["files"] == 4
    assert sql(v2_env, "SELECT count(*) FROM import_items WHERE pdf_enc IS NOT NULL OR wrapped_key IS NOT NULL") == [(0,)]
    progress = client.get(f"/api/v2/orgs/{org}/jobs/{job}/imports").json()[0]
    assert (progress["uploaded"], progress["progress"]["parsed"], progress["progress"]["duplicate"]) == (5, 4, 1)

    # Review queue: qualifications only, never identity, contact, places or dates.
    queue = client.get(f"/api/v2/orgs/{org}/jobs/{job}/review-queue")
    assert len(queue.json()) == 4
    for marker in IDENTITY_MARKERS:
        assert marker not in queue.text, marker
    ranking = client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()
    assert (ranking["groups"], ranking["to_review"]) == ([], 4)  # Unreviewed profiles never enter the ranking.

    for item in queue.json():
        assert unsafe(client, "POST", f"/api/v2/orgs/{org}/profiles/{item['profile_id']}/confirm", {"warnings_acknowledged": True}).status_code == 201
    assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["pending"] == 4
    run_worker(v2_env)
    response = client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking")
    ranking = response.json()
    for marker in IDENTITY_MARKERS:
        assert marker not in response.text, marker
    assert ranking["sort_key"] == "required_documented_desc,preferred_documented_desc,needs_review_asc"
    shape = [((group["required_documented"], group["preferred_documented"], group["needs_review"]), [entry["alias"] for entry in group["entries"]]) for group in ranking["groups"]]
    assert shape == [((2, 1, 1), [1, 3]), ((1, 1, 1), [4]), ((1, 0, 1), [2])]  # A and C tie, in arrival order.
    assert all(group["tie_order"] == "arrival_not_meaningful" for group in ranking["groups"])
    top = ranking["groups"][0]["entries"][0]
    assert top["counts"] == {"required_documented": 2, "required_total": 3, "preferred_documented": 1, "preferred_total": 2, "needs_review": 1}
    assert not any(key in json.dumps(ranking) for key in ("score", "percent", "rank_position", "rejected", "accepted"))

    detail = client.get(f"/api/v2/orgs/{org}/matches/{top['match_id']}")
    assert detail.status_code == 200 and detail.json()["identity"] is None
    for marker in IDENTITY_MARKERS:
        assert marker not in detail.text, marker
    assert any(item["status"] == "documented" and item["candidate_evidence"] for item in detail.json()["comparisons"])

    missing = unsafe(client, "POST", f"/api/v2/orgs/{org}/matches/{top['match_id']}/reveal", {"reason": "interview_scheduled"})
    assert missing.status_code == 422
    revealed = unsafe(client, "POST", f"/api/v2/orgs/{org}/matches/{top['match_id']}/reveal", {"reason": "interview_scheduled", "note": "Entretien prévu"}).json()
    assert revealed["identity"]["full_name"] == "Imported Person 1" and revealed["reveal_reason"] == "interview_scheduled"
    [(details,)] = sql(v2_env, "SELECT details FROM audit_log WHERE action = 'match.identity_revealed'")
    assert details == {"reason": "interview_scheduled"}  # Never the identity or the note.
    after = client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking")
    assert "Imported Person" not in after.text and after.json()["groups"][0]["entries"][0]["identity_revealed"] is True

    # Encrypted at rest; no e-mail to anyone; no automatic action.
    dump = database_dump(v2_env)
    for marker in ("Imported Person", "imported1@example.com", "Fictional College"):
        assert marker not in dump, marker
    assert mailer.outbox == [] or all("imported" not in mail.to for mail in mailer.outbox)


def test_changed_criteria_clear_the_ranking_until_reconfirmed(recruiter, v2_env):
    client, org, job = recruiter
    imported_and_confirmed(client, org, job, v2_env, numbers=(1, 2))
    detail = client.get(f"/api/v2/orgs/{org}/jobs/{job}").json()
    edited = [{**item, "classification": "preferred"} if item["text"] == "Docker" else item for item in detail["requirements"]]
    assert unsafe(client, "PUT", f"/api/v2/orgs/{org}/jobs/{job}/requirements", {"requirements": edited}).status_code == 200
    blocked = client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking")
    assert (blocked.status_code, blocked.json()["detail"]["code"]) == (409, "criteria_review_required")
    unsafe(client, "POST", f"/api/v2/orgs/{org}/jobs/{job}/confirm")
    assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["pending"] == 2
    run_worker(v2_env)
    groups = client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"]
    assert [(group["required_documented"], group["preferred_documented"]) for group in groups] == [(1, 2), (1, 0)]
    assert groups[0]["entries"][0]["counts"]["required_total"] == 2


def test_registered_candidates_appear_only_with_their_visibility_consent(recruiter, v2_env):
    client, org, job = recruiter
    assert unsafe(client, "PATCH", f"/api/v2/orgs/{org}/jobs/{job}", {"status": "open", "visibility": "public"}).status_code == 200
    with new_v2_client() as candidate:
        sign_up(candidate, "applicant@example.com", "candidate")
        version = upload_cv(candidate, make_pdf(SYNTHETIC_CVS[0]["text"])).json()
        unsafe(candidate, "POST", f"/api/v2/me/cv/versions/{version['id']}/confirm", {"warnings_acknowledged": True})
        [offer] = candidate.get("/api/v2/me/public-jobs").json()
        assert (offer["organization"], offer["applied"]) == ("Hiring Org", False)
        refused = unsafe(candidate, "POST", "/api/v2/me/applications", {"job_id": job})
        assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "consent_required")
        unsafe(candidate, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})
        application = unsafe(candidate, "POST", "/api/v2/me/applications", {"job_id": job})
        assert application.status_code == 201
        run_worker(v2_env)
        ranked = client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"]
        [entry] = [entry for group in ranked for entry in group["entries"]]
        assert entry["source"] == "application"
        assert client.get(f"/api/v2/orgs/{org}/matches/{entry['match_id']}").status_code == 200

        # Withdrawing the consent hides the candidate at once, without the worker.
        unsafe(candidate, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": False})
        assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"] == []
        assert client.get(f"/api/v2/orgs/{org}/matches/{entry['match_id']}").status_code == 404
        assert candidate.get("/api/v2/me/applications").json()[0]["visible_to_recruiters"] is False
        unsafe(candidate, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})
        assert len(client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"]) == 1
        assert unsafe(candidate, "DELETE", f"/api/v2/me/applications/{application.json()['id']}").status_code == 204
        assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"] == []


def test_claim_link_lets_the_candidate_delete_or_claim_the_imported_profile(recruiter, v2_env):
    client, org, job = recruiter
    queue = imported_and_confirmed(client, org, job, v2_env, numbers=(1, 2))
    links = [unsafe(client, "POST", f"/api/v2/orgs/{org}/profiles/{item['profile_id']}/invitation").json()["url"] for item in queue]
    tokens = [link.split("token=")[1] for link in links]
    assert all(link.startswith("https://localhost/claim?token=") for link in links)
    with new_v2_client() as anonymous:
        info = unsafe(anonymous, "POST", "/api/v2/claims/inspect", {"token": tokens[0]}).json()
        assert (info["organization"], info["job_title"]) == ("Hiring Org", "Backend Developer")
        assert unsafe(anonymous, "POST", "/api/v2/claims/delete", {"token": tokens[0]}).status_code == 204
        assert unsafe(anonymous, "POST", "/api/v2/claims/inspect", {"token": tokens[0]}).status_code == 404
        assert unsafe(anonymous, "POST", "/api/v2/claims/accept", {"token": tokens[1]}).status_code == 401
    aliases = [entry["alias"] for group in client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"] for entry in group["entries"]]
    assert aliases == [2]

    with new_v2_client() as candidate:
        sign_up(candidate, "imported2@example.com", "candidate")
        assert unsafe(candidate, "POST", "/api/v2/claims/accept", {"token": tokens[1]}).status_code == 204
        [version] = candidate.get("/api/v2/me/cv/versions").json()
        assert version["status"] == "reviewed"  # The candidate confirms it themself.
        assert candidate.get(f"/api/v2/me/cv/versions/{version['id']}").json()["parsed"]["candidate"]["full_name"] == "Imported Person 2"
        # Now a registered candidate: invisible to the organization until they consent and confirm.
        assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"] == []
        unsafe(candidate, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})
        unsafe(candidate, "POST", f"/api/v2/me/cv/versions/{version['id']}/confirm", {"warnings_acknowledged": True})
        run_worker(v2_env)
        assert len(client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"]) == 1
    assert sql(v2_env, "SELECT count(*) FROM candidate_profiles WHERE origin = 'imported'") == [(0,)]


def test_imported_profiles_are_deleted_90_days_after_the_import(recruiter, v2_env):
    client, org, job = recruiter
    imported_and_confirmed(client, org, job, v2_env, numbers=(1,))
    engine = create_engine(v2_env)
    with Session(engine) as session:
        assert run_once(session, now=utcnow() + timedelta(days=89))["expired_imports"] == 0
        assert run_once(session, now=utcnow() + timedelta(days=91))["expired_imports"] == 1
    engine.dispose()
    for table in ("candidate_profiles", "cv_versions", "cv_data_keys", "matches"):
        assert sql(v2_env, f"SELECT count(*) FROM {table}") == [(0,)], table
    # The same pass also expired the recruiter's session (simulated clock): sign in again.
    assert login(client, "recruiter@example.com").status_code == 200
    assert client.get(f"/api/v2/orgs/{org}/jobs/{job}/ranking").json()["groups"] == []


def test_a_batch_of_200_files_is_queued_without_parsing_then_processed_by_the_worker(recruiter, v2_env):
    client, org, job = recruiter
    pdfs = [make_pdf(fictional_cv(number, ["Python"] if number % 2 else ["Docker"])) for number in range(1, 201)]
    batch, responses = import_files(client, org, job, pdfs)
    assert all(response.status_code == 202 and response.json()["status"] == "queued" for response in responses)
    extra = client.post(f"/api/v2/orgs/{org}/imports/{batch}/files", files={"file": ("x.pdf", pdfs[0], "application/pdf")}, headers={"X-CSRF-Token": csrf(client)})
    assert (extra.status_code, extra.json()["detail"]["code"]) == (409, "batch_full")
    assert sql(v2_env, "SELECT status, count(*) FROM import_items GROUP BY status") == [("queued", 200)]
    assert run_worker(v2_env)["files"] == 200
    progress = client.get(f"/api/v2/orgs/{org}/jobs/{job}/imports").json()[0]["progress"]
    assert (progress["parsed"], progress["queued"], progress["failed"]) == (200, 0, 0)
    assert len(client.get(f"/api/v2/orgs/{org}/jobs/{job}/review-queue").json()) == 200


def test_offers_cannot_open_on_unconfirmed_criteria_and_imports_are_rate_limited(v2_client):
    org, job = recruiter_job(v2_client, "drafts@example.com", confirm=False)
    refused = unsafe(v2_client, "PATCH", f"/api/v2/orgs/{org}/jobs/{job}", {"status": "open"})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "criteria_review_required")
    assert unsafe(v2_client, "PATCH", f"/api/v2/orgs/{org}/jobs/{job}", {"visibility": "public"}).json()["detail"]["code"] == "offer_not_open"
    for _ in range(3):
        assert unsafe(v2_client, "POST", f"/api/v2/orgs/{org}/jobs/{job}/imports", {"attestation": True, "file_count": 1}).status_code == 201
    limited = unsafe(v2_client, "POST", f"/api/v2/orgs/{org}/jobs/{job}/imports", {"attestation": True, "file_count": 1})
    assert limited.status_code == 429 and "Retry-After" in limited.headers
