"""Debug: dump raw SP-API response to a file for inspection."""
import asyncio, os, sys, httpx, json
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()
from sp_api import get_amazon_access_token

ENDPOINT = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com").strip('"').strip("'")
MARKETPLACE = os.getenv("SP_API_MARKETPLACE_ID", "A21TJRUUN4KGV")

async def run():
    token = await get_amazon_access_token()
    test_asins = ["B0BQN1D5H1", "B084Z6K3B4"]

    params = {
        "marketplaceIds": MARKETPLACE,
        "identifiers": ",".join(test_asins),
        "identifiersType": "ASIN",
        "includedData": "dimensions,summaries,attributes",
    }
    url = f"{ENDPOINT}/catalog/2022-04-01/items?{urlencode(params)}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers={"x-amz-access-token": token})
        data = resp.json()

    with open("tasks/spapi_debug.json", "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved {len(data.get('items',[]))} items to tasks/spapi_debug.json")

asyncio.run(run())
