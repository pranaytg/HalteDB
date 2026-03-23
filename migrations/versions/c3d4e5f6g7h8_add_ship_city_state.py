"""Add ship_city and ship_state to orders

Revision ID: c3d4e5f6g7h8
Revises: a1b2c3d4e5f6
Create Date: 2026-03-23 12:15:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c3d4e5f6g7h8'
down_revision = 'b2c3d4e5f6g7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('ship_city', sa.String(), nullable=True))
    op.add_column('orders', sa.Column('ship_state', sa.String(), nullable=True))
    op.create_index('ix_orders_ship_city', 'orders', ['ship_city'])
    op.create_index('ix_orders_ship_state', 'orders', ['ship_state'])


def downgrade() -> None:
    op.drop_index('ix_orders_ship_state', table_name='orders')
    op.drop_index('ix_orders_ship_city', table_name='orders')
    op.drop_column('orders', 'ship_state')
    op.drop_column('orders', 'ship_city')
