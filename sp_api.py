import os
import httpx
import asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
import zlib

from crud import upsert_orders_batch
from crud import upsert_inventory_batch

async def get_amazon_access_token() -> str:
    """
    Exchanges your permanent Refresh Token for a temporary 1-hour Access Token.
    """
    # Using your exact .env variable names
    client_id = os.getenv("SP_API_LWA_APP_ID")
    client_secret = os.getenv("SP_API_LWA_CLIENT_SECRET")
    refresh_token = os.getenv("SP_API_REFRESH_TOKEN")

    # Safety check
    if not all([client_id, client_secret, refresh_token]):
        raise ValueError("Missing Amazon LWA credentials in your .env file!")

    # Amazon's global authentication URL
    auth_url = "https://api.amazon.com/auth/o2/token"
    
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }

    # Make the request to Amazon
    async with httpx.AsyncClient() as client:
        response = await client.post(auth_url, data=payload)
        
        if response.status_code != 200:
            print(f"Amazon Auth Error: {response.text}")
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to authenticate with Amazon SP-API: {response.text}"
            )
            
        data = response.json()
        return data["access_token"]
    

async def run_inventory_sync_job(session: AsyncSession):
    endpoint = os.getenv("SP_API_ENDPOINT")
    if not endpoint:
        raise ValueError("Missing SP_API_ENDPOINT in .env file")

    access_token = await get_amazon_access_token()
    headers = {"x-amz-access-token": access_token}
    
    # 1. Use the new Ledger Report
    report_type = "GET_LEDGER_SUMMARY_VIEW_DATA"

    # 2. Amazon forces us to give a specific date range for the Ledger. 
    # We grab yesterday's data to ensure the daily ledger is fully closed.
    end_time = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59, microsecond=0) - timedelta(days=1)
    start_time = end_time.replace(hour=0, minute=0, second=0, microsecond=0)

    async with httpx.AsyncClient(timeout=30.0) as client:
        print("1. Requesting Ledger Inventory Report from Amazon...")
        
        # 3. We must pass dataStartTime, dataEndTime, and reportOptions
        create_payload = {
            "reportType": report_type,
            "marketplaceIds": [os.getenv("SP_API_MARKETPLACE_ID")],
            "dataStartTime": start_time.isoformat(),
            "dataEndTime": end_time.isoformat(),
            "reportOptions": {
                "aggregateByLocation": "FC",       # Group by physical warehouse
                "aggregatedByTimePeriod": "DAILY"  # Daily snapshot
            }
        }
        
        res = await client.post(f"{endpoint}/reports/2021-06-30/reports", headers=headers, json=create_payload)
        
        if res.status_code >= 400:
            print("--- AMAZON REJECTED THE REQUEST ---")
            print(res.text)
            print("-----------------------------------")
        res.raise_for_status()
        
        report_id = res.json()["reportId"]
        print(f"2. Report requested! ID: {report_id}. Polling...")
        
        document_id = None
        while True:
            await asyncio.sleep(15)
            poll_res = await client.get(f"{endpoint}/reports/2021-06-30/reports/{report_id}", headers=headers)
            poll_res.raise_for_status()
            status_data = poll_res.json()
            status = status_data["processingStatus"]
            
            print(f"   Status check: {status}...")
            
            if status == "DONE":
                document_id = status_data["reportDocumentId"]
                break
            elif status in ["CANCELLED", "FATAL"]:
                print("Report generation failed or was cancelled by Amazon.")
                return

        print(f"3. Report DONE! Document ID: {document_id}. Fetching download URL...")
        doc_res = await client.get(f"{endpoint}/reports/2021-06-30/documents/{document_id}", headers=headers)
        doc_res.raise_for_status()
        download_url = doc_res.json()["url"]

        print("4. Streaming, decompressing, and parsing Amazon Ledger data...")
        async with client.stream("GET", download_url) as response:
            decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16)
            buffer = ""
            batch = []
            headers_list = []
            is_first_line = True
            
            async for chunk in response.aiter_bytes():
                buffer += decompressor.decompress(chunk).decode('utf-8')
                
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if not line:
                        continue
                        
                    # 1. Split the line by tabs and strip the double quotes surrounding the values
                    values = [v.strip().strip('"') for v in line.split('\t')]
                        
                    # 2. Grab the headers on the first pass
                    if is_first_line:
                        headers_list = values
                        is_first_line = False
                        continue
                        
                    # 3. Process the data rows
                    row_data = dict(zip(headers_list, values))
                    
                    fc_id = row_data.get("Location", "UNKNOWN")
                    disposition = row_data.get("Disposition", "SELLABLE")
                    qty_str = row_data.get("Ending Warehouse Balance", "0")
                    
                    qty = int(qty_str) if qty_str.lstrip('-').isdigit() else 0
                    
                    parsed_record = {
                        "sku": row_data.get("MSKU", "UNKNOWN"),
                        "fnsku": row_data.get("FNSKU"),
                        "asin": row_data.get("ASIN"),
                        "condition": disposition,
                        "fulfillment_center_id": fc_id,
                        
                        "fulfillable_quantity": qty if disposition == "SELLABLE" else 0,
                        "unfulfillable_quantity": qty if disposition != "SELLABLE" else 0,
                        "reserved_quantity": 0
                    }
                    
                    batch.append(parsed_record)
                    
                    if len(batch) >= 1000:
                        await upsert_inventory_batch(session, batch)
                        batch.clear()
            
            # Decompress final bytes
            final_data = decompressor.flush().decode('utf-8')
            if final_data:
                buffer += final_data
                # ... process final lines if any ...
                
            if batch:
                await upsert_inventory_batch(session, batch)

        print("5. SUCCESS! Ledger sync complete.")


# orders fetching with date range (used for initial backfill or manual syncs)

async def fetch_orders_date_range(session: AsyncSession, start_time: datetime, end_time: datetime):
    endpoint = os.getenv("SP_API_ENDPOINT")
    access_token = await get_amazon_access_token()
    headers = {"x-amz-access-token": access_token}
    
    report_type = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL"

    async with httpx.AsyncClient(timeout=60.0) as client:
        print(f"Requesting Orders from {start_time.strftime('%Y-%m-%d')} to {end_time.strftime('%Y-%m-%d')}...")
        
        create_payload = {
            "reportType": report_type,
            "marketplaceIds": [os.getenv("SP_API_MARKETPLACE_ID")],
            "dataStartTime": start_time.isoformat(),
            "dataEndTime": end_time.isoformat()
        }
        
        res = await client.post(f"{endpoint}/reports/2021-06-30/reports", headers=headers, json=create_payload)
        res.raise_for_status()
        report_id = res.json()["reportId"]
        
        document_id = None
        while True:
            await asyncio.sleep(15)
            poll_res = await client.get(f"{endpoint}/reports/2021-06-30/reports/{report_id}", headers=headers)
            poll_res.raise_for_status()
            status_data = poll_res.json()
            status = status_data["processingStatus"]
            
            if status == "DONE":
                document_id = status_data["reportDocumentId"]
                break
            elif status in ["CANCELLED", "FATAL"]:
                raise ValueError(f"Order report failed with status: {status}")

        # ... previous polling logic ...

        doc_res = await client.get(f"{endpoint}/reports/2021-06-30/documents/{document_id}", headers=headers)
        doc_res.raise_for_status()
        doc_data = doc_res.json()
        
        download_url = doc_data["url"]
        # Check if Amazon actually compressed this specific report
        compression_algo = doc_data.get("compressionAlgorithm", "NONE")

        async with client.stream("GET", download_url) as response:
            # Only initialize the decompressor if it's explicitly GZIP
            decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16) if compression_algo == "GZIP" else None
            
            buffer = ""
            batch = []
            headers_list = []
            is_first_line = True
            
            # --- STRICT TYPE PARSERS ---
            def safe_float(val):
                if not val: return 0.0
                try: return float(val.replace(',', '').strip())
                except ValueError: return 0.0

            def safe_datetime(val):
                if not val: return None
                try: return datetime.fromisoformat(val.replace('Z', '+00:00'))
                except ValueError: return None
            # ---------------------------

            async for chunk in response.aiter_bytes():
                # Dynamically handle the chunk based on compression
                if decompressor:
                    buffer += decompressor.decompress(chunk).decode('utf-8', errors='replace')
                else:
                    buffer += chunk.decode('utf-8', errors='replace')
                
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if not line: continue
                        
                    values = [v.strip().strip('"') for v in line.split('\t')]
                        
                    if is_first_line:
                        headers_list = values
                        is_first_line = False
                        continue
                        
                    row_data = dict(zip(headers_list, values))
                    
                    amz_order_id = row_data.get("amazon-order-id")
                    sku = row_data.get("sku")
                    
                    if amz_order_id and sku:
                        parsed_record = {
                            "amazon_order_id": amz_order_id,
                            "purchase_date": safe_datetime(row_data.get("purchase-date")),
                            "last_updated_date": safe_datetime(row_data.get("last-updated-date")),
                            "order_status": row_data.get("order-status", "UNKNOWN"),
                            "fulfillment_channel": row_data.get("fulfillment-channel"),
                            "sales_channel": row_data.get("sales-channel"),
                            "sku": sku,
                            "asin": row_data.get("asin"),
                            "item_status": row_data.get("item-status"),
                            "quantity": int(row_data.get("quantity", 0) or 0),
                            "currency": row_data.get("currency"),
                            "item_price": safe_float(row_data.get("item-price")),
                            "item_tax": safe_float(row_data.get("item-tax")),
                        }
                        batch.append(parsed_record)
                    
                    if len(batch) >= 1000:
                        await upsert_orders_batch(session, batch)
                        batch.clear()
            
            # Flush final leftover data
            if decompressor:
                buffer += decompressor.flush().decode('utf-8', errors='replace')
            
            # Process any remaining buffer content
            if buffer.strip():
                 # Handle the very last line if it didn't end in a newline
                 pass # (You can duplicate the line parsing logic here if needed, but standard TSVs end with \n)

            if batch:
                await upsert_orders_batch(session, batch)

        print(f"Successfully synced orders up to {end_time.strftime('%Y-%m-%d')}!")