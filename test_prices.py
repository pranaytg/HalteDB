"""Test SP-API pricing with comma-separated ASINs."""
import asyncio, os, sys, httpx
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()
from sp_api import get_amazon_access_token

ENDPOINT = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com").strip('"').strip("'")
MARKETPLACE = os.getenv("SP_API_MARKETPLACE_ID", "A21TJRUUN4KGV")

async def main():
    token = await get_amazon_access_token()
    test_asins = ["B0BNV9V36C", "B0844VKFK3", "B0BQN1D5H1", "B0BQQY3QPW", "B0BRVBMLCL"]
    
    async with httpx.AsyncClient(timeout=30) as client:
        headers = {"x-amz-access-token": token}
        
        # Test 1: Comma separated
        print("=== Testing Comma Separated Asins ===")
        params = {
            "MarketplaceId": MARKETPLACE,
            "ItemType": "Asin",
            "Asins": ",".join(test_asins)
        }
        resp = await client.get(
            f"{ENDPOINT}/products/pricing/v0/price",
            params=params, headers=headers
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        payload = data.get("payload", [])
        print(f"Returned items: {len(payload)}")
        for item in payload:
            print(f"  {item.get('ASIN', '?')}: {item.get('status')}")

asyncio.run(main())
