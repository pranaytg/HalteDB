"""Add inbound_shipments table

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-04-25 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l2m3n4o5p6q7'
down_revision: Union[str, Sequence[str], None] = 'k1l2m3n4o5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS inbound_shipments (
            shipment_id          VARCHAR PRIMARY KEY,
            shipment_name        VARCHAR,
            destination_fc       VARCHAR,
            shipment_status      VARCHAR,
            label_prep_type      VARCHAR,
            box_contents_source  VARCHAR,
            booked_date          TIMESTAMPTZ,
            ship_from_city       VARCHAR,
            ship_from_state      VARCHAR,
            last_synced          TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_inbound_shipments_destination_fc ON inbound_shipments (destination_fc)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_inbound_shipments_shipment_status ON inbound_shipments (shipment_status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS inbound_shipments")
