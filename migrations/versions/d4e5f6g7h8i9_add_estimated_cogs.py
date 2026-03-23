"""Add estimated_cogs table

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-03-23 12:38:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd4e5f6g7h8i9'
down_revision = 'c3d4e5f6g7h8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'estimated_cogs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('sku', sa.String(), nullable=False, unique=True, index=True),
        sa.Column('article_number', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('import_price', sa.Float(), nullable=True, default=0.0),
        sa.Column('import_currency', sa.String(), nullable=True, default='USD'),
        sa.Column('custom_duty', sa.Float(), nullable=True, default=0.0),
        sa.Column('conversion_rate', sa.Float(), nullable=True, default=83.0),
        sa.Column('import_price_inr', sa.Float(), nullable=True, default=0.0),
        sa.Column('gst_percent', sa.Float(), nullable=True, default=18.0),
        sa.Column('gst_amount', sa.Float(), nullable=True, default=0.0),
        sa.Column('shipping_cost', sa.Float(), nullable=True, default=0.0),
        sa.Column('final_price', sa.Float(), nullable=True, default=0.0),
        sa.Column('margin1_percent', sa.Float(), nullable=True, default=0.0),
        sa.Column('margin1_amount', sa.Float(), nullable=True, default=0.0),
        sa.Column('cost_price_halte', sa.Float(), nullable=True, default=0.0),
        sa.Column('marketing_cost', sa.Float(), nullable=True, default=0.0),
        sa.Column('margin2_percent', sa.Float(), nullable=True, default=0.0),
        sa.Column('margin2_amount', sa.Float(), nullable=True, default=0.0),
        sa.Column('selling_price', sa.Float(), nullable=True, default=0.0),
        sa.Column('msp_with_gst', sa.Float(), nullable=True, default=0.0),
        sa.Column('halte_selling_price', sa.Float(), nullable=True, default=0.0),
        sa.Column('amazon_selling_price', sa.Float(), nullable=True, default=0.0),
        sa.Column('profitability', sa.Float(), nullable=True, default=0.0),
        sa.Column('last_updated', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('estimated_cogs')
