"""Add amazon_markup_percent to estimated_cogs

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-05-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'n4o5p6q7r8s9'
down_revision = 'm3n4o5p6q7r8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'estimated_cogs',
        sa.Column('amazon_markup_percent', sa.Float(), nullable=True, server_default='15.0'),
    )


def downgrade() -> None:
    op.drop_column('estimated_cogs', 'amazon_markup_percent')
