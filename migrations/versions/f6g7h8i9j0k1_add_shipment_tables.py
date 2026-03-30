"""Add ship_postal_code, product_specifications, and shipment_estimates tables

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-03-27 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'f6g7h8i9j0k1'
down_revision = 'e5f6g7h8i9j0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add ship_postal_code to orders
    op.add_column('orders', sa.Column('ship_postal_code', sa.String(), nullable=True))
    op.create_index('ix_orders_ship_postal_code', 'orders', ['ship_postal_code'])

    # 2. Create product_specifications table
    op.create_table(
        'product_specifications',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('sku', sa.String(), nullable=False, index=True),
        sa.Column('asin', sa.String(), nullable=True, index=True),
        sa.Column('product_name', sa.String(), nullable=True),
        sa.Column('weight_kg', sa.Float(), nullable=True),
        sa.Column('length_cm', sa.Float(), nullable=True),
        sa.Column('width_cm', sa.Float(), nullable=True),
        sa.Column('height_cm', sa.Float(), nullable=True),
        sa.Column('volumetric_weight_kg', sa.Float(), nullable=True),
        sa.Column('chargeable_weight_kg', sa.Float(), nullable=True),
        sa.Column('last_updated', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('sku', name='uq_product_spec_sku'),
    )

    # 3. Create shipment_estimates table
    op.create_table(
        'shipment_estimates',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('amazon_order_id', sa.String(), nullable=False, index=True),
        sa.Column('sku', sa.String(), nullable=True),
        sa.Column('origin_pincode', sa.String(), nullable=False, server_default='160012'),
        sa.Column('destination_pincode', sa.String(), nullable=True),
        sa.Column('destination_city', sa.String(), nullable=True),
        sa.Column('destination_state', sa.String(), nullable=True),
        sa.Column('package_weight_kg', sa.Float(), nullable=True),
        sa.Column('volumetric_weight_kg', sa.Float(), nullable=True),
        sa.Column('chargeable_weight_kg', sa.Float(), nullable=True),
        sa.Column('amazon_shipping_cost', sa.Float(), nullable=True),
        sa.Column('delhivery_cost', sa.Float(), nullable=True),
        sa.Column('bluedart_cost', sa.Float(), nullable=True),
        sa.Column('dtdc_cost', sa.Float(), nullable=True),
        sa.Column('xpressbees_cost', sa.Float(), nullable=True),
        sa.Column('ekart_cost', sa.Float(), nullable=True),
        sa.Column('cheapest_provider', sa.String(), nullable=True),
        sa.Column('cheapest_cost', sa.Float(), nullable=True),
        sa.Column('delhivery_etd', sa.String(), nullable=True),
        sa.Column('bluedart_etd', sa.String(), nullable=True),
        sa.Column('dtdc_etd', sa.String(), nullable=True),
        sa.Column('xpressbees_etd', sa.String(), nullable=True),
        sa.Column('ekart_etd', sa.String(), nullable=True),
        sa.Column('estimated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('amazon_order_id', 'sku', name='uq_shipment_order_sku'),
    )


def downgrade() -> None:
    op.drop_table('shipment_estimates')
    op.drop_table('product_specifications')
    op.drop_index('ix_orders_ship_postal_code', table_name='orders')
    op.drop_column('orders', 'ship_postal_code')
