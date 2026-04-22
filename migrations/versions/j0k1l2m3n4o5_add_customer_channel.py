"""add channel column to customers

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-04-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j0k1l2m3n4o5'
down_revision: Union[str, Sequence[str], None] = 'i9j0k1l2m3n4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS channel VARCHAR "
        "DEFAULT 'website' NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_customers_channel ON customers (channel)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_customers_channel")
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS channel")
