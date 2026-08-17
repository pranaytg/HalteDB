"""Add website orders sync meta

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-08-16 22:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from typing import Sequence, Union


revision: str = "t0u1v2w3x4y5"
down_revision: Union[str, Sequence[str], None] = "s9t0u1v2w3x4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE sync_meta ADD COLUMN IF NOT EXISTS last_website_orders_sync TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE sync_meta DROP COLUMN IF EXISTS last_website_orders_sync")
