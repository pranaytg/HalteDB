"""Add logic inventory upload tables

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-05-10 17:30:00.000000

"""

from alembic import op


revision = "q7r8s9t0u1v2"
down_revision = "p6q7r8s9t0u1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS logic_inventory_uploads (
          id SERIAL PRIMARY KEY,
          file_name TEXT NOT NULL,
          inventory_month TEXT,
          sheet_count INTEGER NOT NULL DEFAULT 0,
          row_count INTEGER NOT NULL DEFAULT 0,
          sheets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS logic_inventory_rows (
          id BIGSERIAL PRIMARY KEY,
          upload_id INTEGER NOT NULL REFERENCES logic_inventory_uploads(id) ON DELETE CASCADE,
          sheet_name TEXT NOT NULL,
          sheet_index INTEGER NOT NULL DEFAULT 0,
          row_index INTEGER NOT NULL DEFAULT 0,
          row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_logic_inventory_uploads_created ON logic_inventory_uploads (created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_logic_inventory_rows_upload ON logic_inventory_rows (upload_id, sheet_index, row_index)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_logic_inventory_rows_sheet ON logic_inventory_rows (upload_id, sheet_name)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_logic_inventory_rows_sheet")
    op.execute("DROP INDEX IF EXISTS ix_logic_inventory_rows_upload")
    op.execute("DROP INDEX IF EXISTS ix_logic_inventory_uploads_created")
    op.execute("DROP TABLE IF EXISTS logic_inventory_rows")
    op.execute("DROP TABLE IF EXISTS logic_inventory_uploads")
