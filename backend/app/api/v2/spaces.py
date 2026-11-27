"""Recruiter space: minimal organizations (the candidate space lives in candidate.py).

Isolation rules (design §4.5): a role mismatch answers 403; a resource of
another organization answers 404, so its existence is never revealed.
Every query is filtered by the caller's memberships, never by identifier alone.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v2.account import member_count
from app.api.v2.deps import DbDep, SettingsDep, api_error, audit, require_role
from app.api.v2.schemas import Member, Organization, OrganizationCreate
from app.core.config import Settings
from app.db.models import Membership, User
from app.db.models import Organization as OrganizationRow

router = APIRouter(tags=["Spaces"])
MAX_OWNED_ORGANIZATIONS = 5
Recruiter = Depends(require_role("recruiter"))


def organization_payload(db: Session, membership: Membership) -> Organization:
    organization = membership.organization
    return Organization(id=organization.id, name=organization.name, created_at=organization.created_at, org_role=membership.org_role, member_count=member_count(db, organization.id))


def own_membership(db: Session, user: User, organization_id: uuid.UUID) -> Membership:
    membership = db.scalar(select(Membership).where(Membership.organization_id == organization_id, Membership.user_id == user.id))
    if membership is None:
        raise api_error(404, "not_found", "Organization not found.")
    return membership


@router.post("/orgs", status_code=201, response_model=Organization, summary="Create an organization (recruiters)")
def create_organization(body: OrganizationCreate, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> Organization:
    owned = db.scalar(select(func.count()).select_from(Membership).where(Membership.user_id == user.id, Membership.org_role == "owner")) or 0
    if owned >= MAX_OWNED_ORGANIZATIONS:
        raise api_error(409, "organization_limit", f"An account can own at most {MAX_OWNED_ORGANIZATIONS} organizations.")
    organization = OrganizationRow(name=body.name)
    db.add(organization)
    db.flush()
    membership = Membership(user_id=user.id, organization_id=organization.id, org_role="owner")
    db.add(membership)
    audit(db, settings, "organization.created", user.id, "organization", organization.id)
    db.commit()
    db.refresh(membership)
    return organization_payload(db, membership)


@router.get("/orgs", response_model=list[Organization], summary="List my organizations (recruiters)")
def list_organizations(user: User = Recruiter, db: Session = DbDep) -> list[Organization]:
    memberships = db.scalars(select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)).all()
    return [organization_payload(db, membership) for membership in memberships]


@router.get("/orgs/{organization_id}", response_model=Organization, summary="Get one of my organizations (recruiters)")
def get_organization(organization_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep) -> Organization:
    return organization_payload(db, own_membership(db, user, organization_id))


@router.get("/orgs/{organization_id}/members", response_model=list[Member], summary="List the members of one of my organizations")
def list_members(organization_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep) -> list[Member]:
    own_membership(db, user, organization_id)
    rows = db.scalars(select(Membership).where(Membership.organization_id == organization_id).order_by(Membership.created_at)).all()
    return [Member(email=row.user.email, org_role=row.org_role, joined_at=row.created_at) for row in rows]

