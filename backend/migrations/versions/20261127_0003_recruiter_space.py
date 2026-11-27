"""Recruiter space: imported profiles (90-day expiry, claim link), import batches and
the PostgreSQL work queue, and matches with encrypted comparisons and plain counts.

Downgrade note: imported profiles cannot exist without this revision, so the
downgrade deletes them (with their CV versions and data keys) before restoring
`candidate_profiles.user_id NOT NULL`.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-27 20:08:46.915402
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('import_batches',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.Column('job_offer_id', sa.Uuid(), nullable=False),
    sa.Column('attested_by', sa.Uuid(), nullable=True),
    sa.Column('attested_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attestation_version', sa.String(length=32), nullable=False),
    sa.Column('file_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('file_count BETWEEN 1 AND 200', name=op.f('ck_import_batches_file_count')),
    sa.ForeignKeyConstraint(['attested_by'], ['users.id'], name=op.f('fk_import_batches_attested_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['job_offer_id'], ['job_offers.id'], name=op.f('fk_import_batches_job_offer_id_job_offers'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_import_batches_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_import_batches'))
    )
    op.create_index(op.f('ix_import_batches_job_offer_id'), 'import_batches', ['job_offer_id'], unique=False)
    op.create_index(op.f('ix_import_batches_organization_id'), 'import_batches', ['organization_id'], unique=False)
    op.create_table('import_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('batch_id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='queued', nullable=False),
    sa.Column('error_code', sa.String(length=64), nullable=True),
    sa.Column('file_digest', sa.LargeBinary(length=32), nullable=False),
    sa.Column('pdf_enc', sa.LargeBinary(), nullable=True),
    sa.Column('wrapped_key', sa.LargeBinary(), nullable=True),
    sa.Column('candidate_profile_id', sa.Uuid(), nullable=True),
    sa.Column('attempts', sa.SmallInteger(), server_default='0', nullable=False),
    sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('queued', 'parsing', 'parsed', 'failed', 'duplicate')", name=op.f('ck_import_items_status')),
    sa.ForeignKeyConstraint(['batch_id'], ['import_batches.id'], name=op.f('fk_import_items_batch_id_import_batches'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['candidate_profile_id'], ['candidate_profiles.id'], name=op.f('fk_import_items_candidate_profile_id_candidate_profiles'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_import_items_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_import_items')),
    sa.UniqueConstraint('batch_id', 'position', name=op.f('uq_import_items_batch_id_position'))
    )
    op.create_index(op.f('ix_import_items_batch_id'), 'import_items', ['batch_id'], unique=False)
    op.create_index(op.f('ix_import_items_candidate_profile_id'), 'import_items', ['candidate_profile_id'], unique=False)
    op.create_index(op.f('ix_import_items_organization_id'), 'import_items', ['organization_id'], unique=False)
    op.create_index('ix_import_items_queue', 'import_items', ['status', 'created_at'], unique=False)
    op.create_table('matches',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.Column('job_offer_id', sa.Uuid(), nullable=False),
    sa.Column('candidate_profile_id', sa.Uuid(), nullable=False),
    sa.Column('cv_version_id', sa.Uuid(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('alias_number', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='pending', nullable=False),
    sa.Column('comparison_enc', sa.LargeBinary(), nullable=True),
    sa.Column('required_documented', sa.Integer(), nullable=True),
    sa.Column('required_total', sa.Integer(), nullable=True),
    sa.Column('preferred_documented', sa.Integer(), nullable=True),
    sa.Column('preferred_total', sa.Integer(), nullable=True),
    sa.Column('needs_review_count', sa.Integer(), nullable=True),
    sa.Column('computed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('identity_revealed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revealed_by', sa.Uuid(), nullable=True),
    sa.Column('reveal_reason', sa.String(length=32), nullable=True),
    sa.Column('reveal_note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("reveal_reason IS NULL OR reveal_reason IN ('interview_scheduled', 'reference_check', 'candidate_request', 'other')", name=op.f('ck_matches_reveal_reason')),
    sa.CheckConstraint("source IN ('import', 'application')", name=op.f('ck_matches_source')),
    sa.CheckConstraint("status = 'pending' OR (comparison_enc IS NOT NULL AND required_total IS NOT NULL)", name=op.f('ck_matches_current_has_counts')),
    sa.CheckConstraint("status IN ('pending', 'current')", name=op.f('ck_matches_status')),
    sa.ForeignKeyConstraint(['candidate_profile_id'], ['candidate_profiles.id'], name=op.f('fk_matches_candidate_profile_id_candidate_profiles'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['cv_version_id'], ['cv_versions.id'], name=op.f('fk_matches_cv_version_id_cv_versions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['job_offer_id'], ['job_offers.id'], name=op.f('fk_matches_job_offer_id_job_offers'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_matches_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['revealed_by'], ['users.id'], name=op.f('fk_matches_revealed_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_matches')),
    sa.UniqueConstraint('job_offer_id', 'alias_number', name=op.f('uq_matches_job_offer_id_alias_number')),
    sa.UniqueConstraint('job_offer_id', 'candidate_profile_id', name=op.f('uq_matches_job_offer_id_candidate_profile_id'))
    )
    op.create_index(op.f('ix_matches_candidate_profile_id'), 'matches', ['candidate_profile_id'], unique=False)
    op.create_index(op.f('ix_matches_cv_version_id'), 'matches', ['cv_version_id'], unique=False)
    op.create_index(op.f('ix_matches_job_offer_id'), 'matches', ['job_offer_id'], unique=False)
    op.create_index(op.f('ix_matches_organization_id'), 'matches', ['organization_id'], unique=False)
    op.add_column('candidate_profiles', sa.Column('organization_id', sa.Uuid(), nullable=True))
    op.add_column('candidate_profiles', sa.Column('origin', sa.String(length=16), server_default='self', nullable=False))
    op.add_column('candidate_profiles', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('candidate_profiles', sa.Column('claim_token_hash', sa.LargeBinary(length=32), nullable=True))
    op.add_column('candidate_profiles', sa.Column('claim_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.alter_column('candidate_profiles', 'user_id',
               existing_type=sa.UUID(),
               nullable=True)
    op.create_index(op.f('ix_candidate_profiles_expires_at'), 'candidate_profiles', ['expires_at'], unique=False)
    op.create_index(op.f('ix_candidate_profiles_organization_id'), 'candidate_profiles', ['organization_id'], unique=False)
    op.create_unique_constraint(op.f('uq_candidate_profiles_claim_token_hash'), 'candidate_profiles', ['claim_token_hash'])
    op.create_foreign_key(op.f('fk_candidate_profiles_organization_id_organizations'), 'candidate_profiles', 'organizations', ['organization_id'], ['id'], ondelete='CASCADE')
    op.create_check_constraint(op.f('ck_candidate_profiles_origin'), 'candidate_profiles', "origin IN ('self', 'imported')")
    op.create_check_constraint(
        op.f('ck_candidate_profiles_single_owner'), 'candidate_profiles',
        "(origin = 'self' AND user_id IS NOT NULL AND organization_id IS NULL AND expires_at IS NULL)"
        " OR (origin = 'imported' AND user_id IS NULL AND organization_id IS NOT NULL AND expires_at IS NOT NULL)",
    )
    op.add_column('job_offers', sa.Column('created_by', sa.Uuid(), nullable=True))
    op.create_foreign_key(op.f('fk_job_offers_created_by_users'), 'job_offers', 'users', ['created_by'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_index(op.f('ix_matches_organization_id'), table_name='matches')
    op.drop_index(op.f('ix_matches_job_offer_id'), table_name='matches')
    op.drop_index(op.f('ix_matches_cv_version_id'), table_name='matches')
    op.drop_index(op.f('ix_matches_candidate_profile_id'), table_name='matches')
    op.drop_table('matches')
    op.drop_index('ix_import_items_queue', table_name='import_items')
    op.drop_index(op.f('ix_import_items_organization_id'), table_name='import_items')
    op.drop_index(op.f('ix_import_items_candidate_profile_id'), table_name='import_items')
    op.drop_index(op.f('ix_import_items_batch_id'), table_name='import_items')
    op.drop_table('import_items')
    op.drop_index(op.f('ix_import_batches_organization_id'), table_name='import_batches')
    op.drop_index(op.f('ix_import_batches_job_offer_id'), table_name='import_batches')
    op.drop_table('import_batches')
    op.drop_constraint(op.f('fk_job_offers_created_by_users'), 'job_offers', type_='foreignkey')
    op.drop_column('job_offers', 'created_by')
    # Organization offers did not exist before this revision either.
    op.execute("DELETE FROM job_offers WHERE organization_id IS NOT NULL")
    op.execute("DELETE FROM candidate_profiles WHERE origin = 'imported'")
    op.drop_constraint(op.f('ck_candidate_profiles_single_owner'), 'candidate_profiles', type_='check')
    op.drop_constraint(op.f('ck_candidate_profiles_origin'), 'candidate_profiles', type_='check')
    op.drop_constraint(op.f('fk_candidate_profiles_organization_id_organizations'), 'candidate_profiles', type_='foreignkey')
    op.drop_constraint(op.f('uq_candidate_profiles_claim_token_hash'), 'candidate_profiles', type_='unique')
    op.drop_index(op.f('ix_candidate_profiles_organization_id'), table_name='candidate_profiles')
    op.drop_index(op.f('ix_candidate_profiles_expires_at'), table_name='candidate_profiles')
    op.alter_column('candidate_profiles', 'user_id', existing_type=sa.UUID(), nullable=False)
    op.drop_column('candidate_profiles', 'claim_expires_at')
    op.drop_column('candidate_profiles', 'claim_token_hash')
    op.drop_column('candidate_profiles', 'expires_at')
    op.drop_column('candidate_profiles', 'origin')
    op.drop_column('candidate_profiles', 'organization_id')
