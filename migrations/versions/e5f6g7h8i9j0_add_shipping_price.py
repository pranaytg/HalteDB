"""Add shipping_price to orders

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-03-23 13:50:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6g7h8i9j0'
down_revision = 'd4e5f6g7h8i9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('shipping_price', sa.Float(), nullable=True, server_default='0'))


def downgrade() -> None:
    op.drop_column('orders', 'shipping_price')
