"""Candidate space: profiles, encrypted CV versions with per-version data keys, private job targets.

CV content is stored as AES-256-GCM ciphertext only (`*_enc`). The wrapped data
key lives in `cv_data_keys`, so deleting it shreds the version.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-27 15:25:58.508620
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('candidate_profiles',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_candidate_profiles_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_candidate_profiles')),
    sa.UniqueConstraint('user_id', name=op.f('uq_candidate_profiles_user_id'))
    )
    op.create_table('job_offers',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=True),
    sa.Column('owner_user_id', sa.Uuid(), nullable=True),
    sa.Column('visibility', sa.String(length=16), server_default='private', nullable=False),
    sa.Column('status', sa.String(length=16), server_default='draft', nullable=False),
    sa.Column('title', sa.String(length=2000), nullable=True),
    sa.Column('source_text', sa.Text(), nullable=False),
    sa.Column('analysis', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('reviewed_requirements', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('criteria_confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('draft', 'open', 'closed')", name=op.f('ck_job_offers_status')),
    sa.CheckConstraint("visibility IN ('private', 'public')", name=op.f('ck_job_offers_visibility')),
    sa.CheckConstraint('(organization_id IS NULL) <> (owner_user_id IS NULL)', name=op.f('ck_job_offers_single_owner')),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_job_offers_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], name=op.f('fk_job_offers_owner_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_job_offers'))
    )
    op.create_index(op.f('ix_job_offers_organization_id'), 'job_offers', ['organization_id'], unique=False)
    op.create_index(op.f('ix_job_offers_owner_user_id'), 'job_offers', ['owner_user_id'], unique=False)
    op.create_table('cv_versions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('candidate_profile_id', sa.Uuid(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('page_count', sa.SmallInteger(), nullable=False),
    sa.Column('extracted_text_enc', sa.LargeBinary(), nullable=False),
    sa.Column('parsed_enc', sa.LargeBinary(), nullable=False),
    sa.Column('reviewed_enc', sa.LargeBinary(), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('original_file_ref', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('confirmed_at IS NULL OR reviewed_enc IS NOT NULL', name=op.f('ck_cv_versions_confirmed_after_review')),
    sa.CheckConstraint('number >= 1', name=op.f('ck_cv_versions_number_positive')),
    sa.ForeignKeyConstraint(['candidate_profile_id'], ['candidate_profiles.id'], name=op.f('fk_cv_versions_candidate_profile_id_candidate_profiles'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cv_versions')),
    sa.UniqueConstraint('candidate_profile_id', 'number', name=op.f('uq_cv_versions_candidate_profile_id_number'))
    )
    op.create_index(op.f('ix_cv_versions_candidate_profile_id'), 'cv_versions', ['candidate_profile_id'], unique=False)
    op.create_table('cv_data_keys',
    sa.Column('cv_version_id', sa.Uuid(), nullable=False),
    sa.Column('wrapped_key', sa.LargeBinary(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['cv_version_id'], ['cv_versions.id'], name=op.f('fk_cv_data_keys_cv_version_id_cv_versions'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('cv_version_id', name=op.f('pk_cv_data_keys'))
    )


def downgrade() -> None:
    op.drop_table('cv_data_keys')
    op.drop_index(op.f('ix_cv_versions_candidate_profile_id'), table_name='cv_versions')
    op.drop_table('cv_versions')
    op.drop_index(op.f('ix_job_offers_owner_user_id'), table_name='job_offers')
    op.drop_index(op.f('ix_job_offers_organization_id'), table_name='job_offers')
    op.drop_table('job_offers')
    op.drop_table('candidate_profiles')
