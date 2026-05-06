"""Add carrier bill audit tables

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-04-30 13:10:00.000000

"""

from alembic import op

revision = "n4o5p6q7r8s9"
down_revision = "m3n4o5p6q7r8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS carrier_bill_uploads (
          id SERIAL PRIMARY KEY,
          carrier TEXT NOT NULL,
          invoice_number TEXT,
          invoice_date DATE,
          billing_period TEXT,
          file_name TEXT,
          row_count INTEGER NOT NULL DEFAULT 0,
          matched_count INTEGER NOT NULL DEFAULT 0,
          overcharged_count INTEGER NOT NULL DEFAULT 0,
          total_actual NUMERIC(14, 2) NOT NULL DEFAULT 0,
          total_proposed NUMERIC(14, 2) NOT NULL DEFAULT 0,
          total_variance NUMERIC(14, 2) NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS order_shipment_refs (
          id SERIAL PRIMARY KEY,
          amazon_order_id TEXT NOT NULL,
          sku TEXT,
          carrier TEXT,
          awb_number TEXT,
          order_ref TEXT,
          source TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (carrier, awb_number)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS carrier_bill_lines (
          id BIGSERIAL PRIMARY KEY,
          upload_id INTEGER NOT NULL REFERENCES carrier_bill_uploads(id) ON DELETE CASCADE,
          carrier TEXT NOT NULL,
          invoice_number TEXT,
          invoice_date DATE,
          ship_date DATE,
          awb_number TEXT,
          order_ref TEXT,
          origin_area TEXT,
          destination_area TEXT,
          destination_pincode TEXT,
          service_type TEXT,
          commodity TEXT,
          actual_weight_kg NUMERIC(10, 3),
          charged_weight_kg NUMERIC(10, 3),
          pieces INTEGER,
          freight_amount NUMERIC(14, 2),
          fuel_surcharge NUMERIC(14, 2),
          other_charges NUMERIC(14, 2),
          tax_amount NUMERIC(14, 2),
          declared_value NUMERIC(14, 2),
          actual_billed_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
          raw_row_json JSONB,
          matched_amazon_order_id TEXT,
          matched_sku TEXT,
          match_confidence NUMERIC(5, 2),
          match_method TEXT,
          proposed_amount NUMERIC(14, 2),
          variance_amount NUMERIC(14, 2),
          variance_percent NUMERIC(8, 2),
          audit_status TEXT NOT NULL DEFAULT 'unmatched',
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_carrier_bill_uploads_created ON carrier_bill_uploads (created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_upload ON carrier_bill_lines (upload_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_carrier_status ON carrier_bill_lines (carrier, audit_status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_awb ON carrier_bill_lines (awb_number)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_order_ref ON carrier_bill_lines (order_ref)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_shipment_refs_order ON order_shipment_refs (amazon_order_id, sku)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_order_shipment_refs_order")
    op.execute("DROP INDEX IF EXISTS ix_carrier_bill_lines_order_ref")
    op.execute("DROP INDEX IF EXISTS ix_carrier_bill_lines_awb")
    op.execute("DROP INDEX IF EXISTS ix_carrier_bill_lines_carrier_status")
    op.execute("DROP INDEX IF EXISTS ix_carrier_bill_lines_upload")
    op.execute("DROP INDEX IF EXISTS ix_carrier_bill_uploads_created")
    op.execute("DROP TABLE IF EXISTS carrier_bill_lines")
    op.execute("DROP TABLE IF EXISTS order_shipment_refs")
    op.execute("DROP TABLE IF EXISTS carrier_bill_uploads")
