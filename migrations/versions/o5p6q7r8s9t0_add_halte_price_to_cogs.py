"""Add halte_price to cogs

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-05-04 19:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'o5p6q7r8s9t0'
down_revision: Union[str, Sequence[str], None] = 'n4o5p6q7r8s9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE cogs ADD COLUMN IF NOT EXISTS halte_price DOUBLE PRECISION")


def downgrade() -> None:
    op.execute("ALTER TABLE cogs DROP COLUMN IF EXISTS halte_price")
