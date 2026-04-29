"""Add profit_percent to estimated_cogs

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-04-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'm3n4o5p6q7r8'
down_revision: Union[str, Sequence[str], None] = 'l2m3n4o5p6q7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE estimated_cogs "
        "ADD COLUMN IF NOT EXISTS profit_percent DOUBLE PRECISION DEFAULT 0.0"
    )
    # Backfill: profit_percent = profitability / amazon_selling_price * 100
    op.execute(
        "UPDATE estimated_cogs "
        "SET profit_percent = ROUND((profitability / amazon_selling_price * 100)::numeric, 1) "
        "WHERE amazon_selling_price IS NOT NULL "
        "  AND amazon_selling_price > 0 "
        "  AND (profit_percent IS NULL OR profit_percent = 0)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE estimated_cogs DROP COLUMN IF EXISTS profit_percent")
