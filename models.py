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
    halte_price = Column(Float, nullable=True)
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

    # Profitability: invoice - COGS - shipping
    cogs_price = Column(Float, nullable=True)
    shipping_price = Column(Float, nullable=True, default=0.0)  # from SP-API or ₹100 flat for self-fulfilled
    amazon_fee = Column(Float, nullable=True)  # Actual referral/commission fee from SP-API finance events
    profit = Column(Float, nullable=True)

    # Shipping address (from SP-API flat file)
    ship_city = Column(String, nullable=True, index=True)
    ship_state = Column(String, nullable=True, index=True)
    ship_postal_code = Column(String, nullable=True, index=True)

    # Prevent duplicate items on the exact same order
    __table_args__ = (
        UniqueConstraint('amazon_order_id', 'sku', name='uq_order_sku'),
    )


class SyncMeta(Base):
    """Singleton row tracking last successful sync timestamps."""
    __tablename__ = "sync_meta"

    id = Column(Integer, primary_key=True, default=1)
    last_orders_sync = Column(DateTime(timezone=True), nullable=True)
    last_inventory_sync = Column(DateTime(timezone=True), nullable=True)


class EstimatedCogs(Base):
    """Full COGS estimation with import pricing, duties, margins, and selling prices."""
    __tablename__ = "estimated_cogs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, unique=True, index=True, nullable=False)
    article_number = Column(String, nullable=True)
    brand = Column(String, nullable=True)
    category = Column(String, nullable=True)

    # Import pricing
    import_price = Column(Float, default=0.0)          # in foreign currency
    import_currency = Column(String, default="USD")     # USD / EUR
    custom_duty = Column(Float, default=0.0)            # in INR
    conversion_rate = Column(Float, default=83.0)       # e.g. 1 USD = 83 INR

    # Calculated fields
    import_price_inr = Column(Float, default=0.0)       # import_price * conversion_rate
    gst_percent = Column(Float, default=18.0)
    gst_amount = Column(Float, default=0.0)
    shipping_cost = Column(Float, default=0.0)
    final_price = Column(Float, default=0.0)            # import_price_inr + custom_duty + gst_amount + shipping_cost

    margin1_percent = Column(Float, default=0.0)
    margin1_amount = Column(Float, default=0.0)
    cost_price_halte = Column(Float, default=0.0)       # final_price + margin1_amount

    marketing_cost = Column(Float, default=0.0)
    margin2_percent = Column(Float, default=0.0)
    margin2_amount = Column(Float, default=0.0)
    selling_price = Column(Float, default=0.0)          # cost_price_halte + marketing_cost + margin2_amount

    msp_with_gst = Column(Float, default=0.0)           # = selling_price (GST already applied at base; no second pass)
    halte_selling_price = Column(Float, default=0.0)    # selling_price * 1.05
    amazon_markup_percent = Column(Float, default=15.0) # extra markup applied on top of Halte SP
    amazon_selling_price = Column(Float, default=0.0)   # halte_selling_price * (1 + amazon_markup_percent/100)

    profitability = Column(Float, default=0.0)          # Amazon SP - COGS - Amazon Fee - Shipping - Marketing
    profit_percent = Column(Float, default=0.0)         # profitability / amazon_selling_price * 100
    amazon_fee_percent = Column(Float, default=15.0)    # Amazon referral fee percentage

    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Customer(Base):
    """Customer data for CRM and messaging."""
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True, index=True)
    state = Column(String, nullable=True, index=True)
    pincode = Column(String, nullable=True, index=True)
    total_orders = Column(Integer, default=0)
    total_spent = Column(Float, default=0.0)
    last_order_date = Column(DateTime(timezone=True), nullable=True)
    channel = Column(String, nullable=False, default="website", index=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProductSpecification(Base):
    """Product weight and dimensions fetched from SP-API Catalog."""
    __tablename__ = "product_specifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, unique=True, index=True, nullable=False)
    asin = Column(String, nullable=True, index=True)
    product_name = Column(String, nullable=True)
    weight_kg = Column(Float, nullable=True)
    length_cm = Column(Float, nullable=True)
    width_cm = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    volumetric_weight_kg = Column(Float, nullable=True)      # L*W*H / 5000
    chargeable_weight_kg = Column(Float, nullable=True)      # max(weight, volumetric)
    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class InboundShipment(Base):
    """Amazon FBA inbound shipments — items in transit to FCs.

    Sourced from SP-API /fba/inbound/v0/shipments. Independent of the
    `inventory` table; this represents shipments themselves, not balances.
    """
    __tablename__ = "inbound_shipments"

    shipment_id = Column(String, primary_key=True)
    shipment_name = Column(String, nullable=True)
    destination_fc = Column(String, index=True, nullable=True)
    shipment_status = Column(String, index=True, nullable=True)
    label_prep_type = Column(String, nullable=True)
    box_contents_source = Column(String, nullable=True)
    booked_date = Column(DateTime(timezone=True), nullable=True)  # parsed from ShipmentName
    ship_from_city = Column(String, nullable=True)
    ship_from_state = Column(String, nullable=True)
    last_synced = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ShipmentEstimate(Base):
    """Shipping rate estimates from multiple carriers for each order."""
    __tablename__ = "shipment_estimates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    amazon_order_id = Column(String, index=True, nullable=False)
    sku = Column(String, nullable=True)
    origin_pincode = Column(String, nullable=False, default="160012")
    destination_pincode = Column(String, nullable=True)
    destination_city = Column(String, nullable=True)
    destination_state = Column(String, nullable=True)
    package_weight_kg = Column(Float, nullable=True)
    volumetric_weight_kg = Column(Float, nullable=True)
    chargeable_weight_kg = Column(Float, nullable=True)
    amazon_shipping_cost = Column(Float, nullable=True)
    delhivery_cost = Column(Float, nullable=True)
    bluedart_cost = Column(Float, nullable=True)
    dtdc_cost = Column(Float, nullable=True)
    xpressbees_cost = Column(Float, nullable=True)
    ekart_cost = Column(Float, nullable=True)
    cheapest_provider = Column(String, nullable=True)
    cheapest_cost = Column(Float, nullable=True)
    delhivery_etd = Column(String, nullable=True)
    bluedart_etd = Column(String, nullable=True)
    dtdc_etd = Column(String, nullable=True)
    xpressbees_etd = Column(String, nullable=True)
    ekart_etd = Column(String, nullable=True)
    rate_source = Column(String, nullable=True)  # "shiprocket" | "sp_api_finance" | "sp_api_pending" | "shiprocket_failed"
    estimated_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('amazon_order_id', 'sku', name='uq_shipment_order_sku'),
    )
