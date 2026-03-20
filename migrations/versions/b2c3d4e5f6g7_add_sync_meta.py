"""add sync_meta table

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'sync_meta',
        sa.Column('id', sa.Integer(), primary_key=True, default=1),
        sa.Column('last_orders_sync', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_inventory_sync', sa.DateTime(timezone=True), nullable=True),
    )
    # Insert the singleton row
    op.execute("INSERT INTO sync_meta (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table('sync_meta')
