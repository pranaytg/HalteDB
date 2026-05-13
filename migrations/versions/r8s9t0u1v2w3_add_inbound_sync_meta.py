"""Add inbound shipment sync metadata

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-05-13 00:00:00.000000

"""

from alembic import op


revision = "r8s9t0u1v2w3"
down_revision = "q7r8s9t0u1v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE sync_meta ADD COLUMN IF NOT EXISTS last_inbound_shipments_sync TIMESTAMPTZ")
    op.execute("ALTER TABLE sync_meta ADD COLUMN IF NOT EXISTS last_inbound_shipments_error TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE sync_meta DROP COLUMN IF EXISTS last_inbound_shipments_error")
    op.execute("ALTER TABLE sync_meta DROP COLUMN IF EXISTS last_inbound_shipments_sync")
