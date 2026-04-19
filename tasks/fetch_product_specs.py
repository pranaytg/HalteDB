import asyncio
import os
import sys
import logging
import httpx
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, text
from urllib.parse import urlencode

# Add project root to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from models import ProductSpecification
from sp_api import get_amazon_access_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fetch_product_specs")

# Database setup
DATABASE_URL = os.getenv("SUPABASE_URL")
if not DATABASE_URL:
    raise ValueError("SUPABASE_URL not configured")

engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

API_ENDPOINT = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com")
MARKETPLACE_ID = os.getenv("SP_API_MARKETPLACE_ID", "A21TJRUUN4KGV")

async def get_sku_asin_mapping(session: AsyncSession) -> dict[str, str]:
    """Fetch all unique SKUs and their ASINs from the orders table."""
    result = await session.execute(text("SELECT sku, max(asin) as asin FROM orders WHERE sku IS NOT NULL AND asin IS NOT NULL GROUP BY sku"))
    return {row[0]: row[1] for row in result.all()}

async def fetch_specifications_for_asins(asins: list[str], access_token: str) -> dict:
    """Fetch dimension data from SP-API Catalog Items v2022-04-01."""
    if not asins:
        return {}
        
    asin_list = ",".join(asins)
    params = {
        "marketplaceIds": MARKETPLACE_ID,
        "identifiers": asin_list,
        "identifiersType": "ASIN",
        "includedData": "dimensions"
    }
    
    headers = {
        "x-amz-access-token": access_token,
        "Content-Type": "application/json"
    }

    url = f"{API_ENDPOINT}/catalog/2022-04-01/items?{urlencode(params)}"
    
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code == 429:
            logger.warning("Rate limit hit on SP-API Catalog Items, sleeping 5s...")
            await asyncio.sleep(5)
            return await fetch_specifications_for_asins(asins, access_token)
            
        resp.raise_for_status()
        return resp.json().get("items", [])

def extract_dimensions(item: dict) -> dict:
    """Extract weight and dimensions from a catalog item response."""
    result = {
        "weight_kg": None,
        "length_cm": None,
        "width_cm": None,
        "height_cm": None
    }
    
    dimensions = item.get("dimensions", [])
    if not dimensions:
        return result
        
    # Prefer item dimensions over package dimensions if available, 
    # but package dimensions are what matters for shipping
    package_dims = next((d for d in dimensions if "package" in d.get("dimensionType", "").lower() or "shipping" in d.get("dimensionType", "").lower()), None)
    item_dims = next((d for d in dimensions if "item" in d.get("dimensionType", "").lower()), None)
    
    dims_to_use = package_dims or item_dims or dimensions[0]
    
    if "weight" in dims_to_use:
        w_val = dims_to_use["weight"].get("value")
        w_unit = dims_to_use["weight"].get("unit", "").lower()
        if w_val:
            if w_unit in ["kilograms", "kg", "kilogram"]: result["weight_kg"] = w_val
            elif w_unit in ["grams", "g", "gram"]: result["weight_kg"] = w_val / 1000.0
            elif w_unit in ["pounds", "lb", "lbs"]: result["weight_kg"] = w_val * 0.453592
            elif w_unit in ["ounces", "oz"]: result["weight_kg"] = w_val * 0.0283495
            
    if "length" in dims_to_use:
        l_val = dims_to_use["length"].get("value")
        l_unit = dims_to_use["length"].get("unit", "").lower()
        if l_val:
            if l_unit in ["centimeters", "cm", "centimeter"]: result["length_cm"] = l_val
            elif l_unit in ["meters", "m", "meter"]: result["length_cm"] = l_val * 100
            elif l_unit in ["millimeters", "mm", "millimeter"]: result["length_cm"] = l_val / 10.0
            elif l_unit in ["inches", "in", "inch"]: result["length_cm"] = l_val * 2.54

    if "width" in dims_to_use:
        w_val = dims_to_use["width"].get("value")
        w_unit = dims_to_use["width"].get("unit", "").lower()
        if w_val:
            if w_unit in ["centimeters", "cm", "centimeter"]: result["width_cm"] = w_val
            elif w_unit in ["meters", "m", "meter"]: result["width_cm"] = w_val * 100
            elif w_unit in ["millimeters", "mm", "millimeter"]: result["width_cm"] = w_val / 10.0
            elif w_unit in ["inches", "in", "inch"]: result["width_cm"] = w_val * 2.54

    if "height" in dims_to_use:
        h_val = dims_to_use["height"].get("value")
        h_unit = dims_to_use["height"].get("unit", "").lower()
        if h_val:
            if h_unit in ["centimeters", "cm", "centimeter"]: result["height_cm"] = h_val
            elif h_unit in ["meters", "m", "meter"]: result["height_cm"] = h_val * 100
            elif h_unit in ["millimeters", "mm", "millimeter"]: result["height_cm"] = h_val / 10.0
            elif h_unit in ["inches", "in", "inch"]: result["height_cm"] = h_val * 2.54

    return result

async def run_sync():
    logger.info("Starting Product Specifications Sync...")
    
    async with AsyncSessionLocal() as session:
        sku_to_asin = await get_sku_asin_mapping(session)
        logger.info(f"Found {len(sku_to_asin)} unique SKUs in orders table.")
        
        # Get existing SKUs in product_specifications to avoid full refetch every time
        existing_result = await session.execute(select(ProductSpecification.sku))
        existing_skus = {row[0] for row in existing_result.all()}
        
        # Determine items to fetch (can also backfill all to refresh data)
        # For this script, let's fetch those that don't exist
        missing_skus = {sku: asin for sku, asin in sku_to_asin.items() if sku not in existing_skus}
        logger.info(f"Fetching specs for {len(missing_skus)} missing SKUs.")
        
        if not missing_skus:
            logger.info("All SKUs have specifications. Done.")
            return

        access_token = await get_amazon_access_token()
        
        # API limits 20 ASINs per request
        all_skus = list(missing_skus.keys())
        batch_size = 20
        
        for i in range(0, len(all_skus), batch_size):
            sku_batch = all_skus[i:i+batch_size]
            asin_batch = [missing_skus[s] for s in sku_batch]
            
            logger.info(f"Fetching batch {i//batch_size + 1}/{(len(all_skus) + batch_size - 1)//batch_size} ({len(asin_batch)} ASINs)")
            
            try:
                items_data = await fetch_specifications_for_asins(asin_batch, access_token)
                
                # Map ASIN back to SKU
                asin_to_sku = {asin: sku for sku, asin in missing_skus.items() if sku in sku_batch}
                
                new_specs = []
                for item in items_data:
                    asin = item.get("asin")
                    if asin not in asin_to_sku:
                        continue
                        
                    sku = asin_to_sku[asin]
                    dims = extract_dimensions(item)
                    
                    # Calculate volumetric weight and chargeable weight
                    vol_weight = None
                    if dims["length_cm"] and dims["width_cm"] and dims["height_cm"]:
                        vol_weight = round((dims["length_cm"] * dims["width_cm"] * dims["height_cm"]) / 5000.0, 3)
                    
                    chargeable_weight = None
                    if dims["weight_kg"] is not None and vol_weight is not None:
                        chargeable_weight = max(dims["weight_kg"], vol_weight)
                    elif dims["weight_kg"] is not None:
                        chargeable_weight = dims["weight_kg"]
                    elif vol_weight is not None:
                        chargeable_weight = vol_weight
                    
                    spec = ProductSpecification(
                        sku=sku,
                        asin=asin,
                        product_name=item.get("summaries", [{}])[0].get("itemName") if item.get("summaries") else None,
                        weight_kg=dims["weight_kg"],
                        length_cm=dims["length_cm"],
                        width_cm=dims["width_cm"],
                        height_cm=dims["height_cm"],
                        volumetric_weight_kg=vol_weight,
                        chargeable_weight_kg=chargeable_weight
                    )
                    new_specs.append(spec)
                
                if new_specs:
                    session.add_all(new_specs)
                    await session.commit()
                    logger.info(f"Saved {len(new_specs)} specifications")
                    
                # Rate limit safety
                await asyncio.sleep(0.5)
                
            except Exception as e:
                logger.error(f"Error processing batch: {e}")
                
        logger.info("Product Specifications Sync complete.")

if __name__ == "__main__":
    asyncio.run(run_sync())
