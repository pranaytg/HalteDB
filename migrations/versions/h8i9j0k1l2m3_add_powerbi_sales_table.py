"""Add PowerBISales table for Power BI invoice exports

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-04-06 14:20:00.000000

"""

from alembic import op

revision = "h8i9j0k1l2m3"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS "PowerBISales" (
          "Date" DATE,
          "Year" INTEGER,
          "Month_Num" INTEGER,
          "Month_Name" TEXT,
          "Month_Year" TEXT,
          "Quarter" INTEGER,
          "Quarter_Name" TEXT,
          "Business" TEXT,
          "Invoice Number" TEXT,
          "Invoice Date" TIMESTAMP,
          "Transaction Type" TEXT,
          "Order Id" TEXT,
          "Quantity" NUMERIC(18, 2),
          "BRAND" TEXT,
          "Item Description" TEXT,
          "Asin" TEXT,
          "Sku" TEXT,
          "Category" TEXT,
          "Segment" TEXT,
          "Ship To City" TEXT,
          "Ship To State" TEXT,
          "Ship To Country" TEXT,
          "Ship To Postal Code" TEXT,
          "Invoice Amount" NUMERIC(18, 2),
          "Principal Amount" NUMERIC(18, 2),
          "Warehouse Id" TEXT,
          "Customer Bill To Gstid" TEXT,
          "Buyer Name" TEXT,
          "Source" TEXT,
          "Channel" TEXT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS "ix_PowerBISales_InvoiceDate"
        ON "PowerBISales" ("Invoice Date")
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS "ix_PowerBISales_OrderId"
        ON "PowerBISales" ("Order Id")
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS "ix_PowerBISales_Sku"
        ON "PowerBISales" ("Sku")
        """
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS "ix_PowerBISales_Sku"')
    op.execute('DROP INDEX IF EXISTS "ix_PowerBISales_OrderId"')
    op.execute('DROP INDEX IF EXISTS "ix_PowerBISales_InvoiceDate"')
    op.execute('DROP TABLE IF EXISTS "PowerBISales"')
