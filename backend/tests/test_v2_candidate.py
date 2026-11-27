"""Candidate space API (phase 7): versions, reviews, coverage, gaps, encryption at rest, export and deletion."""

import json

import pytest
from conftest import SYNTHETIC_CVS, make_pdf
from sqlalchemy import create_engine, text
from v2_helpers import PASSWORD, csrf, sign_up, unsafe, upload_cv

from app.storage import files

CV_TEXT = SYNTHETIC_CVS[0]["text"]  # Avery Example: Python, FastAPI, Git; English (Fluent).
JOB = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\nTechnical environment: PostgreSQL, Redis\n"
PLAINTEXT_MARKERS = ["Avery Example", "avery@example.com", "Fictional Computing College", "Practice API", "Fictional Python Fundamentals"]


@pytest.fixture
def candidate(v2_client):
    sign_up(v2_client, "candidate@example.com", "candidate")
    return v2_client


def confirm(client, version_id):
    return unsafe(client, "POST", f"/api/v2/me/cv/versions/{version_id}/confirm", {"warnings_acknowledged": True})


def add_target(client, job=JOB):
    response = unsafe(client, "POST", "/api/v2/me/targets", {"text": job})
    assert response.status_code == 201, response.text
    return response.json()


def requirement(target, label):
    return next(item for item in target["requirements"] if item["text"] == label)


def database_dump(url: str) -> str:
    """Every row of every application table, as text: what a stolen database would show."""
    engine = create_engine(url)
    with engine.connect() as connection:
        tables = connection.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).all()
        dump = "\n".join(str(row) for table in tables for row in connection.execute(text(f'SELECT * FROM "{table}"')).all())
    engine.dispose()
    return dump


def test_coverage_needs_both_reviews_and_counts_exactly(candidate):
    assert candidate.get("/api/v2/candidate/overview").json()["next_step"] == "upload_cv"
    version = upload_cv(candidate, make_pdf(CV_TEXT))
    assert version.status_code == 201, version.text
    version = version.json()
    assert (version["number"], version["status"], version["current"], version["has_original"]) == (1, "to_review", True, False)
    assert [skill["name"] for skill in version["parsed"]["candidate"]["technical_skills"]] == ["Python", "FastAPI", "Git"]
    target = add_target(candidate)
    coverage_url = f"/api/v2/me/targets/{target['id']}/coverage"

    # Neither review: blocked. CV confirmed only: still blocked on the criteria.
    assert candidate.get(coverage_url).json()["detail"]["code"] == "cv_review_required"
    assert candidate.get("/api/v2/candidate/overview").json()["next_step"] == "review_cv"
    assert confirm(candidate, version["id"]).json()["status"] == "confirmed"
    assert candidate.get("/api/v2/candidate/overview").json()["next_step"] == "review_criteria"
    blocked = candidate.get(coverage_url)
    assert (blocked.status_code, blocked.json()["detail"]["code"]) == (409, "criteria_review_required")
    assert candidate.get(f"/api/v2/me/targets/{target['id']}/gaps").json()["detail"]["code"] == "criteria_review_required"

    assert unsafe(candidate, "POST", f"/api/v2/me/targets/{target['id']}/confirm").json()["criteria_confirmed_at"]
    report = candidate.get(coverage_url)
    assert report.status_code == 200, report.text
    report = report.json()
    assert report["counts"] == {"required_documented": 1, "required_total": 3, "preferred_documented": 1, "preferred_total": 2, "unspecified_documented": 0, "unspecified_total": 0, "needs_review": 1}
    assert report["notice"] == "documentary_coverage_not_competence" and report["cv_version"]["number"] == 1
    documented = next(item for item in report["comparisons"] if item["requirement_text"] == "Python")
    assert documented["status"] == "documented" and documented["candidate_evidence"] and documented["job_evidence"][0]["quote"]
    assert "score" not in json.dumps(report).lower() and "%" not in json.dumps(report["counts"])
    assert candidate.get("/api/v2/candidate/overview").json()["next_step"] == "view_coverage"

    gaps = candidate.get(f"/api/v2/me/targets/{target['id']}/gaps").json()["gaps"]
    assert [(gap["requirement_text"], gap["kind"], gap["section"]) for gap in gaps] == [
        ("Docker", "add_if_true", "technical_skills"), ("Fluent English", "interpretation", "languages"), ("Kubernetes", "add_if_true", "technical_skills"),
    ]


def test_edits_clear_confirmations_and_new_versions_never_overwrite(candidate):
    first = upload_cv(candidate, make_pdf(CV_TEXT)).json()
    confirm(candidate, first["id"])
    target = add_target(candidate)
    unsafe(candidate, "POST", f"/api/v2/me/targets/{target['id']}/confirm")
    coverage_url = f"/api/v2/me/targets/{target['id']}/coverage"
    assert candidate.get(coverage_url).status_code == 200

    # Editing the criteria clears their confirmation.
    labels = [{**item, "classification": "preferred"} if item["text"] == "Docker" else item for item in target["requirements"]]
    edited = unsafe(candidate, "PUT", f"/api/v2/me/targets/{target['id']}/requirements", {"requirements": labels})
    assert edited.status_code == 200 and edited.json()["criteria_confirmed_at"] is None and edited.json()["requirements_reviewed"]
    assert candidate.get(coverage_url).json()["detail"]["code"] == "criteria_review_required"
    unsafe(candidate, "POST", f"/api/v2/me/targets/{target['id']}/confirm")
    assert candidate.get(coverage_url).json()["counts"]["required_total"] == 2

    # A correction must stay supported by the source (same rule as the demo).
    unsupported = unsafe(candidate, "PUT", f"/api/v2/me/targets/{target['id']}/requirements", {"requirements": [{**requirement(target, "Docker"), "text": "Docker and ten years of Rust"}]})
    assert (unsupported.status_code, unsupported.json()["detail"]["code"]) == (422, "unsupported_correction")

    # A new upload adds version 2 and leaves version 1 untouched and readable.
    second = upload_cv(candidate, make_pdf(CV_TEXT)).json()
    assert (second["number"], second["status"]) == (2, "to_review")
    assert candidate.get(coverage_url).json()["detail"]["code"] == "cv_review_required"
    old = candidate.get(f"/api/v2/me/cv/versions/{first['id']}").json()
    assert (old["number"], old["status"], old["current"]) == (1, "confirmed", False)
    assert old["reviewed_profile"]["full_name"] == "Avery Example"
    superseded = unsafe(candidate, "PUT", f"/api/v2/me/cv/versions/{first['id']}/review", {"profile": old["reviewed_profile"]})
    assert (superseded.status_code, superseded.json()["detail"]["code"]) == (409, "version_superseded")
    assert [item["number"] for item in candidate.get("/api/v2/me/cv/versions").json()] == [2, 1]

    # Reviewing version 2: the candidate adds Docker themself, then confirms.
    profile = second["parsed"]["candidate"]
    profile["technical_skills"].append({"name": "Docker", "category": "cloud_devops"})
    profile["technical_skills"] = [skill for skill in profile["technical_skills"] if skill["name"] != "Git"]
    reviewed = unsafe(candidate, "PUT", f"/api/v2/me/cv/versions/{second['id']}/review", {"profile": profile}).json()
    assert reviewed["status"] == "reviewed" and reviewed["parsed"]["candidate"]["technical_skills"][-1]["name"] == "Git"
    confirm(candidate, second["id"])
    report = candidate.get(coverage_url).json()
    assert report["cv_version"]["number"] == 2
    assert (report["counts"]["required_documented"], report["counts"]["preferred_documented"]) == (1, 2)
    # Another edit after confirmation clears it again.
    unsafe(candidate, "PUT", f"/api/v2/me/cv/versions/{second['id']}/review", {"profile": profile})
    assert candidate.get(coverage_url).json()["detail"]["code"] == "cv_review_required"

    diff = candidate.get(f"/api/v2/me/cv/diff?from={first['id']}&to={second['id']}").json()
    skills = next(section for section in diff["sections"] if section["section"] == "technical_skills")
    assert (diff["from_version"]["number"], diff["to_version"]["number"]) == (1, 2)
    assert (skills["added"], skills["removed"], skills["unchanged"]) == (["Docker"], ["Git"], 2)


def test_stored_cv_content_is_ciphertext_only(candidate, v2_env):
    version = upload_cv(candidate, make_pdf(CV_TEXT)).json()
    profile = version["parsed"]["candidate"]
    profile["full_name"] = "Avery Example"
    unsafe(candidate, "PUT", f"/api/v2/me/cv/versions/{version['id']}/review", {"profile": profile})
    confirm(candidate, version["id"])
    target = add_target(candidate)
    unsafe(candidate, "POST", f"/api/v2/me/targets/{target['id']}/confirm")
    assert candidate.get(f"/api/v2/me/targets/{target['id']}/coverage").status_code == 200
    dump = database_dump(v2_env)
    for marker in PLAINTEXT_MARKERS:
        assert marker not in dump, marker
    engine = create_engine(v2_env)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT v.extracted_text_enc, v.parsed_enc, v.reviewed_enc, k.wrapped_key FROM cv_versions v JOIN cv_data_keys k ON k.cv_version_id = v.id")).one()
    engine.dispose()
    for blob in row:
        assert bytes(blob)[:1] == b"\x01" and b"Avery" not in bytes(blob) and b"Python" not in bytes(blob)


def test_original_pdf_is_off_by_default_and_encrypted_when_enabled(candidate, monkeypatch, tmp_path):
    pdf = make_pdf(CV_TEXT)
    refused = upload_cv(candidate, pdf, keep_original=True)
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "original_storage_disabled")
    assert candidate.get("/api/v2/candidate/overview").json()["original_storage_available"] is False
    assert not (tmp_path / "cv_files").exists()

    monkeypatch.setenv("CV_ORIGINAL_STORAGE", "enabled")
    version = upload_cv(candidate, pdf, keep_original=True).json()
    assert version["has_original"] is True
    stored = list((tmp_path / "cv_files").iterdir())
    assert [path.name for path in stored] == [f"{version['id']}.bin"]
    assert stored[0].read_bytes()[:1] == b"\x01" and b"%PDF" not in stored[0].read_bytes() and b"Avery" not in stored[0].read_bytes()
    download = candidate.get(f"/api/v2/me/cv/versions/{version['id']}/original")
    assert download.status_code == 200 and download.content == pdf and download.headers["content-type"] == "application/pdf"
    without = upload_cv(candidate, pdf).json()
    assert without["has_original"] is False
    assert candidate.get(f"/api/v2/me/cv/versions/{without['id']}/original").status_code == 404


def test_export_is_complete(candidate):
    version = upload_cv(candidate, make_pdf(CV_TEXT)).json()
    confirm(candidate, version["id"])
    target = add_target(candidate)
    unsafe(candidate, "PUT", "/api/v2/me/consents/marketing", {"granted": True})
    response = candidate.get("/api/v2/me/export")
    assert response.status_code == 200 and "attachment" in response.headers["content-disposition"]
    data = response.json()
    assert data["format"] == "talentflow-export-v1" and data["account"]["email"] == "candidate@example.com"
    assert {item["purpose"] for item in data["consents"]} == {"processing", "marketing"}
    [exported] = data["cv_versions"]
    assert exported["number"] == 1 and "Avery Example" in exported["extracted_text"]
    assert exported["extraction"]["candidate"]["email"] == "avery@example.com"
    assert exported["reviewed_profile"]["full_name"] == "Avery Example" and exported["original_pdf_base64"] is None
    [post] = data["job_posts"]
    assert post["source_text"] == JOB and post["title"] == target["title"]


def test_account_deletion_erases_rows_keys_and_files(candidate, v2_env, monkeypatch, tmp_path):
    monkeypatch.setenv("CV_ORIGINAL_STORAGE", "enabled")
    for _ in range(2):
        assert upload_cv(candidate, make_pdf(CV_TEXT), keep_original=True).status_code == 201
    add_target(candidate)
    assert len(list((tmp_path / "cv_files").iterdir())) == 2
    response = candidate.request("DELETE", "/api/v2/me", json={"password": PASSWORD}, headers={"X-CSRF-Token": csrf(candidate)})
    assert response.status_code == 204
    engine = create_engine(v2_env)
    with engine.connect() as connection:
        for table in ("users", "candidate_profiles", "cv_versions", "cv_data_keys", "job_offers", "consents", "sessions"):
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0, table
        actions = connection.scalars(text("SELECT action FROM audit_log ORDER BY id")).all()
    engine.dispose()
    assert list((tmp_path / "cv_files").iterdir()) == []
    assert actions[-1] == "account.deleted"
    for marker in PLAINTEXT_MARKERS + ["candidate@example.com"]:
        assert marker not in database_dump(v2_env)


def test_worker_removes_orphan_files_only(v2_env, tmp_path, monkeypatch):
    import os
    import time
    import uuid

    from sqlalchemy.orm import Session

    from app.worker import run_once

    directory = tmp_path / "cv_files"
    directory.mkdir()
    old, fresh = directory / f"{uuid.uuid4()}.bin", directory / f"{uuid.uuid4()}.bin"
    old.write_bytes(b"\x01orphan")
    fresh.write_bytes(b"\x01in progress")
    hours_ago = time.time() - 7200
    os.utime(old, (hours_ago, hours_ago))
    engine = create_engine(v2_env)
    with Session(engine) as session:
        assert run_once(session)["orphan_files"] == 1
    engine.dispose()
    assert not old.exists() and fresh.exists()
    assert files.files_directory() == directory


def test_without_the_data_key_cv_routes_answer_503_and_the_rest_works(candidate, monkeypatch):
    from app.storage.crypto import master_key

    monkeypatch.setenv("TALENTFLOW_DATA_KEY", "change-me-generate-a-key")
    master_key.cache_clear()
    response = upload_cv(candidate, make_pdf(CV_TEXT))
    assert (response.status_code, response.json()["detail"]["code"]) == (503, "encryption_not_configured")
    assert candidate.get("/api/v2/me/cv/versions").json() == []
    assert candidate.get("/api/v2/candidate/overview").status_code == 200
    assert candidate.get("/api/v2/auth/me").status_code == 200
    master_key.cache_clear()


def test_upload_rejects_non_pdf_and_bounds_versions(candidate, monkeypatch):
    response = upload_cv(candidate, b"not a pdf at all")
    assert (response.status_code, response.json()["detail"]["code"]) == (415, "invalid_file_type")
    from app.api.v2 import candidate as module

    monkeypatch.setattr(module, "MAX_CV_VERSIONS", 1)
    assert upload_cv(candidate, make_pdf(CV_TEXT)).status_code == 201
    limited = upload_cv(candidate, make_pdf(CV_TEXT))
    assert (limited.status_code, limited.json()["detail"]["code"]) == (409, "version_limit")


def test_visibility_is_an_opt_in_consent_withdrawn_immediately(candidate):
    assert candidate.get("/api/v2/candidate/overview").json()["recruiter_visibility"] is False
    unsafe(candidate, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})
    assert candidate.get("/api/v2/candidate/overview").json()["recruiter_visibility"] is True
    unsafe(candidate, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": False})
    assert candidate.get("/api/v2/candidate/overview").json()["recruiter_visibility"] is False


def test_target_deletion_and_original_text_are_owner_only(candidate):
    target = add_target(candidate)
    detail = candidate.get(f"/api/v2/me/targets/{target['id']}").json()
    assert detail["source_text"] == JOB and len(detail["requirements"]) == 6
    assert unsafe(candidate, "DELETE", f"/api/v2/me/targets/{target['id']}").status_code == 204
    assert candidate.get(f"/api/v2/me/targets/{target['id']}").status_code == 404
    assert candidate.get("/api/v2/me/targets").json() == []
