"""add cogs table and profit column to orders

Revision ID: a1b2c3d4e5f6
Revises: 529845055c45
Create Date: 2026-03-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '529845055c45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create the COGS table
    op.create_table('cogs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('sku', sa.String(), nullable=False),
        sa.Column('cogs_price', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('last_updated', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('sku')
    )
    op.create_index(op.f('ix_cogs_id'), 'cogs', ['id'], unique=False)
    op.create_index(op.f('ix_cogs_sku'), 'cogs', ['sku'], unique=True)

    # Add profit and cogs_price columns to orders table
    op.add_column('orders', sa.Column('cogs_price', sa.Float(), nullable=True))
    op.add_column('orders', sa.Column('profit', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('orders', 'profit')
    op.drop_column('orders', 'cogs_price')
    op.drop_index(op.f('ix_cogs_sku'), table_name='cogs')
    op.drop_index(op.f('ix_cogs_id'), table_name='cogs')
    op.drop_table('cogs')
