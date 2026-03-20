from sqlalchemy import Column, Integer, String, Float, DateTime, UniqueConstraint, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import declarative_base, relationship

# This is the base class all your models will inherit from
Base = declarative_base()

class Inventory(Base):
    __tablename__ = "inventory"

    # Primary Key
    id = Column(Integer, primary_key=True, index=True)
    
    # Core Amazon Identifiers
    sku = Column(String, index=True, nullable=False)
    fnsku = Column(String, index=True)
    asin = Column(String, index=True)
    condition = Column(String, default="NewItem", nullable=False)
    
    # Warehouse Identification
    fulfillment_center_id = Column(String, index=True, nullable=False) 
    
    # SP-API Granular Quantities
    fulfillable_quantity = Column(Integer, default=0, nullable=False)
    unfulfillable_quantity = Column(Integer, default=0, nullable=False)
    reserved_quantity = Column(Integer, default=0, nullable=False)
    inbound_working_quantity = Column(Integer, default=0, nullable=False)
    inbound_shipped_quantity = Column(Integer, default=0, nullable=False)
    inbound_receiving_quantity = Column(Integer, default=0, nullable=False)
    
    # Audit trail
    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # CRITICAL: This ensures we only have one row per SKU + Warehouse + Condition.
    # When we stream data, if this combination exists, we update. If not, we insert.
    __table_args__ = (
        UniqueConstraint('sku', 'fulfillment_center_id', 'condition', name='uq_sku_fc_condition'),
    )


class Cogs(Base):
    """Cost of Goods Sold per SKU. Linked to inventory by SKU."""
    __tablename__ = "cogs"

    id = Column(Integer, primary_key=True, index=True)
    sku = Column(String, unique=True, index=True, nullable=False)
    cogs_price = Column(Float, nullable=False, default=0.0)
    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    amazon_order_id = Column(String, index=True, nullable=False)
    purchase_date = Column(DateTime(timezone=True), index=True)
    last_updated_date = Column(DateTime(timezone=True))
    
    order_status = Column(String) 
    fulfillment_channel = Column(String) 
    sales_channel = Column(String) 

    sku = Column(String, index=True, nullable=False)
    asin = Column(String)
    item_status = Column(String)
    quantity = Column(Integer, default=0)

    currency = Column(String)
    item_price = Column(Float, default=0.0)
    item_tax = Column(Float, default=0.0)

    # Profitability: selling price minus COGS
    cogs_price = Column(Float, nullable=True)
    profit = Column(Float, nullable=True)

    # Prevent duplicate items on the exact same order
    __table_args__ = (
        UniqueConstraint('amazon_order_id', 'sku', name='uq_order_sku'),
    )
