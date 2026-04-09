"""Add customers table and amazon_fee_percent to estimated_cogs

Revision ID: g7h8i9j0k1l2
Revises: f6g7h8i9j0k1
Create Date: 2026-04-05 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'g7h8i9j0k1l2'
down_revision = 'f6g7h8i9j0k1'
branch_labels = None
depends_on = None


def upgrade():
    # Create customers table
    op.create_table(
        'customers',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('customer_id', sa.String(), unique=True, nullable=False, index=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('phone', sa.String(), nullable=True),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('address', sa.String(), nullable=True),
        sa.Column('city', sa.String(), nullable=True, index=True),
        sa.Column('state', sa.String(), nullable=True, index=True),
        sa.Column('pincode', sa.String(), nullable=True, index=True),
        sa.Column('total_orders', sa.Integer(), default=0),
        sa.Column('total_spent', sa.Float(), default=0.0),
        sa.Column('last_order_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Add amazon_fee_percent column to estimated_cogs
    op.add_column('estimated_cogs',
        sa.Column('amazon_fee_percent', sa.Float(), server_default='15.0', nullable=True)
    )


def downgrade():
    op.drop_table('customers')
    op.drop_column('estimated_cogs', 'amazon_fee_percent')
