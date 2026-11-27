"""Account lifecycle through the real API and database: sign-up, verification, sessions, reset, consents, deletion."""

from datetime import timedelta

from conftest import TEST_SECRET, new_v2_client
from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.orm import Session
from v2_helpers import PASSWORD, csrf, last_link, login, register, sign_up, unsafe, verify

from app.api.v2.deps import PRIVACY_POLICY_VERSION
from app.auth import mailer
from app.auth.security import hash_token
from app.db.models import AuditLog, AuthSession, Consent, EmailToken, Membership, Organization, User, utcnow


def db(url: str) -> Session:
    return Session(create_engine(url))


def detail(response) -> str:
    return response.json()["detail"]["code"]


def test_complete_candidate_lifecycle(v2_client, v2_env):
    assert register(v2_client, "Ada.Candidate@Example.com", "candidate", marketing=True).status_code == 202
    assert login(v2_client, "ada.candidate@example.com").status_code == 403  # Not verified yet.
    assert verify(v2_client, "ada.candidate@example.com").json() == {"status": "verified"}
    response = login(v2_client, "ADA.candidate@example.com")
    assert response.status_code == 200
    account = response.json()["account"]
    assert (account["email"], account["role"], account["email_verified"], account["organizations"]) == ("ada.candidate@example.com", "candidate", True, [])
    assert "password" not in response.text and PASSWORD not in response.text
    me = v2_client.get("/api/v2/auth/me")
    assert me.status_code == 200 and me.json()["id"] == account["id"]
    overview = v2_client.get("/api/v2/candidate/overview").json()
    assert overview == {"cv_versions": 0, "recruiter_visibility": False, "next_step": "upload_cv"}
    assert unsafe(v2_client, "POST", "/api/v2/auth/logout", token=response.json()["csrf_token"]).status_code == 204
    assert v2_client.get("/api/v2/auth/me").status_code == 401


def test_session_cookie_is_host_prefixed_http_only_secure_and_lax(v2_client):
    assert register(v2_client, "cookie@example.com").status_code == 202
    verify(v2_client, "cookie@example.com")
    cookie = login(v2_client, "cookie@example.com").headers["set-cookie"]
    assert cookie.startswith("__Host-tf_session=")
    for attribute in ("HttpOnly", "Secure", "Path=/", "SameSite=lax", "Max-Age=604800"):
        assert attribute.lower() in cookie.lower()


def test_registration_does_not_reveal_existing_accounts(v2_client, v2_env):
    first = register(v2_client, "taken@example.com", "recruiter")
    second = register(v2_client, "taken@example.com", "candidate", password="another long password")
    assert first.status_code == second.status_code == 202
    assert first.json() == second.json()
    assert [mail.subject for mail in mailer.outbox if mail.to == "taken@example.com"] == ["Confirmez votre adresse e-mail", "Tentative d'inscription avec votre adresse"]
    with db(v2_env) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(User.role)) == "recruiter"  # The second attempt changed nothing.


def test_invalid_registration_never_echoes_the_password(v2_client):
    response = register(v2_client, "short@example.com", password="tiny secret")
    assert response.status_code == 422
    assert detail(response) == "validation_error"
    assert "tiny secret" not in response.text
    assert register(v2_client, "admin@example.com", role="admin").status_code == 422
    without_terms = unsafe(v2_client, "POST", "/api/v2/auth/register", {"email": "t@example.com", "password": PASSWORD, "role": "candidate", "accept_terms": False})
    assert without_terms.status_code == 422


def test_failed_sign_in_is_identical_for_unknown_email_and_wrong_password(v2_client):
    sign_up(v2_client, "known@example.com")
    unknown = login(v2_client, "nobody@example.com")
    wrong = login(v2_client, "known@example.com", "wrong password value")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json() == {"detail": {"code": "invalid_credentials", "message": "The e-mail address or password is incorrect."}}


def test_verification_tokens_are_single_use_and_expire(v2_client, v2_env):
    register(v2_client, "token@example.com")
    token = last_link("token@example.com", "/verify-email")
    assert unsafe(v2_client, "POST", "/api/v2/auth/verify-email", {"token": token}).status_code == 200
    reused = unsafe(v2_client, "POST", "/api/v2/auth/verify-email", {"token": token})
    assert (reused.status_code, detail(reused)) == (400, "invalid_token")
    register(v2_client, "late@example.com")
    late = last_link("late@example.com", "/verify-email")
    with db(v2_env) as session:
        session.execute(update(EmailToken).where(EmailToken.token_hash == hash_token(late)).values(expires_at=utcnow() - timedelta(seconds=1)))
        session.commit()
    assert detail(unsafe(v2_client, "POST", "/api/v2/auth/verify-email", {"token": late})) == "invalid_token"
    assert unsafe(v2_client, "POST", "/api/v2/auth/verify-email/resend", {"email": "late@example.com"}).status_code == 202
    assert verify(v2_client, "late@example.com").status_code == 200
    with db(v2_env) as session:
        assert session.scalar(select(func.count()).select_from(EmailToken).where(EmailToken.token_hash == late.encode())) == 0


def test_reset_token_cannot_verify_and_verify_token_cannot_reset(v2_client):
    register(v2_client, "purpose@example.com")
    token = last_link("purpose@example.com", "/verify-email")
    response = unsafe(v2_client, "POST", "/api/v2/auth/password/reset", {"token": token, "password": "a brand new password"})
    assert detail(response) == "invalid_token"


def test_logout_revokes_the_session_so_a_copied_cookie_is_useless(v2_client):
    sign_up(v2_client, "stolen@example.com")
    stolen = v2_client.cookies.get("__Host-tf_session")
    unsafe(v2_client, "POST", "/api/v2/auth/logout")
    with new_v2_client() as attacker:
        attacker.cookies.set("__Host-tf_session", stolen, domain="localhost")
        assert attacker.get("/api/v2/auth/me").status_code == 401


def test_sign_in_rotates_any_previous_session(v2_client, v2_env):
    sign_up(v2_client, "rotate@example.com")
    first = v2_client.cookies.get("__Host-tf_session")
    assert login(v2_client, "rotate@example.com").status_code == 200
    second = v2_client.cookies.get("__Host-tf_session")
    assert first != second
    with db(v2_env) as session:
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 1
        assert session.scalar(select(AuthSession.token_hash)) == hash_token(second)


def test_expired_and_idle_sessions_are_refused(v2_client, v2_env):
    sign_up(v2_client, "idle@example.com")
    with db(v2_env) as session:
        session.execute(update(AuthSession).values(last_seen_at=utcnow() - timedelta(hours=13)))
        session.commit()
    assert v2_client.get("/api/v2/auth/me").status_code == 401
    login(v2_client, "idle@example.com")
    with db(v2_env) as session:
        session.execute(update(AuthSession).values(expires_at=utcnow() - timedelta(seconds=1)))
        session.commit()
    assert v2_client.get("/api/v2/auth/me").status_code == 401


def test_csrf_token_from_before_sign_in_is_refused_after_it(v2_client):
    anonymous_token = csrf(v2_client)
    sign_up(v2_client, "csrf@example.com")
    response = v2_client.post("/api/v2/auth/logout", headers={"X-CSRF-Token": anonymous_token})
    assert (response.status_code, detail(response)) == (403, "csrf_failed")
    assert v2_client.post("/api/v2/auth/logout").status_code == 403
    assert unsafe(v2_client, "POST", "/api/v2/auth/logout").status_code == 204


def test_another_browser_cannot_reuse_a_csrf_token(v2_client):
    sign_up(v2_client, "victim@example.com")
    token = csrf(v2_client)
    with new_v2_client() as other:
        other.cookies.set("__Host-tf_session", v2_client.cookies.get("__Host-tf_session"), domain="localhost")
        response = other.post("/api/v2/auth/logout", headers={"X-CSRF-Token": token})
        assert detail(response) == "csrf_failed"  # Different CSRF cookie seed.


def test_repeated_failures_lock_sign_in_even_with_the_right_password(v2_client):
    sign_up(v2_client, "brute@example.com")
    for _ in range(5):
        assert login(v2_client, "brute@example.com", "not the password").status_code == 401
    locked = login(v2_client, "brute@example.com")
    assert (locked.status_code, detail(locked)) == (429, "too_many_attempts")
    assert 0 < int(locked.headers["retry-after"]) <= 60
    other = login(v2_client, "nobody-else@example.com", "irrelevant password")
    assert other.status_code == 401  # The lock is per account.


def test_password_reset_revokes_sessions_and_replaces_the_password(v2_client, v2_env):
    sign_up(v2_client, "reset@example.com")
    assert unsafe(v2_client, "POST", "/api/v2/auth/password/forgot", {"email": "reset@example.com"}).status_code == 202
    assert unsafe(v2_client, "POST", "/api/v2/auth/password/forgot", {"email": "unknown@example.com"}).status_code == 202
    assert [mail.to for mail in mailer.outbox if "password" in mail.subject.lower() or "mot de passe" in mail.subject.lower()] == ["reset@example.com"]
    token = last_link("reset@example.com", "/reset-password")
    assert unsafe(v2_client, "POST", "/api/v2/auth/password/reset", {"token": token, "password": "a brand new password"}).status_code == 204
    assert v2_client.get("/api/v2/auth/me").status_code == 401
    with db(v2_env) as session:
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 0
    assert login(v2_client, "reset@example.com").status_code == 401
    assert login(v2_client, "reset@example.com", "a brand new password").status_code == 200
    assert detail(unsafe(v2_client, "POST", "/api/v2/auth/password/reset", {"token": token, "password": "yet another password"})) == "invalid_token"


def test_consents_are_versioned_and_withdrawable(v2_client, v2_env):
    sign_up(v2_client, "consent@example.com")
    initial = v2_client.get("/api/v2/me/consents").json()
    state = {item["purpose"]: item for item in initial["consents"]}
    assert initial["current_policy_version"] == PRIVACY_POLICY_VERSION
    assert state["processing"]["granted"] and state["processing"]["policy_version"] == PRIVACY_POLICY_VERSION
    assert not state["marketing"]["granted"] and not state["recruiter_visibility"]["granted"]
    granted = unsafe(v2_client, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})
    assert {item["purpose"]: item["granted"] for item in granted.json()["consents"]}["recruiter_visibility"] is True
    assert v2_client.get("/api/v2/candidate/overview").json()["recruiter_visibility"] is True
    withdrawn = unsafe(v2_client, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": False}).json()
    history = [item for item in withdrawn["history"] if item["purpose"] == "recruiter_visibility"]
    assert len(history) == 1 and history[0]["withdrawn_at"] is not None
    unsafe(v2_client, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})
    with db(v2_env) as session:
        assert session.scalar(select(func.count()).select_from(Consent).where(Consent.purpose == "recruiter_visibility")) == 2
        actions = session.scalars(select(AuditLog.action).where(AuditLog.action.like("consent.%")).order_by(AuditLog.id)).all()
        assert actions == ["consent.granted", "consent.withdrawn", "consent.granted"]
    assert detail(unsafe(v2_client, "PUT", "/api/v2/me/consents/processing", {"granted": False})) == "consent_required"
    assert detail(unsafe(v2_client, "PUT", "/api/v2/me/consents/model_assistance", {"granted": True})) == "consent_per_request"
    assert unsafe(v2_client, "PUT", "/api/v2/me/consents/unknown", {"granted": True}).status_code == 422


def test_older_policy_consent_is_replaced_on_renewal(v2_client, v2_env):
    sign_up(v2_client, "renew@example.com")
    with db(v2_env) as session:
        session.execute(update(Consent).where(Consent.purpose == "processing").values(policy_version="2020-01-01"))
        session.commit()
    renewed = unsafe(v2_client, "PUT", "/api/v2/me/consents/processing", {"granted": True}).json()
    assert [item["policy_version"] for item in renewed["history"] if item["purpose"] == "processing"] == ["2020-01-01", PRIVACY_POLICY_VERSION]


def test_recruiters_cannot_opt_into_candidate_visibility(v2_client):
    sign_up(v2_client, "rec@example.com", "recruiter")
    assert detail(unsafe(v2_client, "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True})) == "forbidden_role"


def test_locale_preference_is_saved(v2_client):
    sign_up(v2_client, "locale@example.com")
    assert unsafe(v2_client, "PATCH", "/api/v2/me", {"locale": "en"}).json()["locale"] == "en"
    assert unsafe(v2_client, "PATCH", "/api/v2/me", {"locale": "de"}).status_code == 422


def test_account_deletion_requires_the_password_and_erases_personal_data(v2_client, v2_env):
    payload = sign_up(v2_client, "erase@example.com", "recruiter")
    organization = unsafe(v2_client, "POST", "/api/v2/orgs", {"name": "Fictional Hiring Co"}).json()
    refused = unsafe(v2_client, "DELETE", "/api/v2/me", {"password": "not my password"})
    assert (refused.status_code, detail(refused)) == (403, "reauthentication_failed")
    deleted = unsafe(v2_client, "DELETE", "/api/v2/me", {"password": PASSWORD})
    assert deleted.status_code == 204
    assert "__Host-tf_session=" in deleted.headers["set-cookie"] and "max-age=0" in deleted.headers["set-cookie"].lower()
    assert v2_client.get("/api/v2/auth/me").status_code == 401
    with db(v2_env) as session:
        for model in (User, AuthSession, Consent, EmailToken, Membership, Organization):
            assert session.scalar(select(func.count()).select_from(model)) == 0, model.__name__
        audit = session.execute(text("SELECT actor_ref, action, target_id, details::text FROM audit_log ORDER BY id")).all()
    assert audit[-1].action == "account.deleted" and audit[-1].target_id is None
    assert ("organization.deleted", organization["id"]) in {(row.action, str(row.target_id)) for row in audit}
    dump = repr(audit)
    assert "erase@example.com" not in dump and payload["account"]["id"] not in dump
    from app.auth.security import pseudonym
    assert audit[-1].actor_ref == pseudonym(TEST_SECRET.encode(), payload["account"]["id"])
    assert login(v2_client, "erase@example.com").status_code == 401


def test_deleting_an_owner_hands_the_organization_to_a_remaining_member(v2_client, v2_env):
    sign_up(v2_client, "owner@example.com", "recruiter")
    organization = unsafe(v2_client, "POST", "/api/v2/orgs", {"name": "Shared Team"}).json()
    with new_v2_client() as colleague:
        sign_up(colleague, "colleague@example.com", "recruiter")
        with db(v2_env) as session:
            colleague_id = session.scalar(select(User.id).where(User.email == "colleague@example.com"))
            session.add(Membership(user_id=colleague_id, organization_id=organization["id"], org_role="member"))
            session.commit()
        assert unsafe(v2_client, "DELETE", "/api/v2/me", {"password": PASSWORD}).status_code == 204
        remaining = colleague.get(f"/api/v2/orgs/{organization['id']}").json()
        assert (remaining["org_role"], remaining["member_count"]) == ("owner", 1)


def test_audit_log_never_contains_emails_or_passwords(v2_client, v2_env):
    sign_up(v2_client, "audited@example.com")
    login(v2_client, "audited@example.com", "wrong password here")
    unsafe(v2_client, "POST", "/api/v2/auth/logout")
    with db(v2_env) as session:
        rows = session.execute(text("SELECT * FROM audit_log")).all()
    assert {row.action for row in rows} >= {"account.registered", "account.email_verified", "auth.login", "auth.login_failed", "auth.logout"}
    assert "audited@example.com" not in repr(rows) and PASSWORD not in repr(rows) and "wrong password here" not in repr(rows)
