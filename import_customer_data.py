"""
Import real customer data from CSV files into the database.
Consolidates data from multiple sales channels and creates customer records.

Run: python import_customer_data.py
"""

import argparse
import asyncio
import os
import csv
import re
import sys
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from collections import defaultdict

# Handle Windows encoding
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
if not DATABASE_URL:
    raise ValueError("Missing SUPABASE_URL in environment variables")

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession)

CUSTOMER_DATA_DIR = Path(__file__).parent / "customer"

# CSV column mappings for different file formats
COLUMN_MAPPINGS = {
    # Generic mapping that works for most files
    "default": {
        "date": ["ORDER DATE", "order date"],
        "order_id": ["ORDER ID NO.", "order id no.", "ORD-"],
        "sku": ["SKU", "sku"],
        "quantity": ["QUANTITY", "quantity"],
        "amount": ["TOTAL AMOUNT", "total amount"],
        "customer_name": ["CLIENT NAME", "client name"],
        "phone": ["CONTACT NO.", "contact no."],
        "email": ["Email ID", "EMAIL", "eMAIL"],
        "state": ["STATE", "state"],
        "status": ["STATUS", "status"],
        "brand": ["BRAND", "brand"],
    }
}


def parse_phone(phone_str):
    """Parse phone number to clean format."""
    if not phone_str:
        return None
    # Remove all non-digit characters
    digits = re.sub(r"\D", "", str(phone_str))
    # Handle various formats
    if len(digits) >= 10:
        # Take last 10 digits
        return digits[-10:]
    return digits if digits else None


def parse_date(date_str):
    """Parse date from various formats."""
    if not date_str:
        return None
    date_str = str(date_str).strip()
    formats = ["%d-%b-%Y", "%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d", "%m-%d-%Y"]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
        except ValueError:
            continue
        # Reject implausible future dates (bad source data, e.g. year 2205)
        if dt > datetime.now() + timedelta(days=1):
            return None
        return dt
    return None


def normalize_state_name(state):
    """Normalize state names."""
    if not state:
        return None
    state_map = {
        "delhi": "Delhi",
        "du": "Delhi",
        "karnataka": "Karnataka",
        "maharashtra": "Maharashtra",
        "tamil nadu": "Tamil Nadu",
        "tn": "Tamil Nadu",
        "uttar pradesh": "Uttar Pradesh",
        "up": "Uttar Pradesh",
        "andhra pradesh": "Andhra Pradesh",
        "ap": "Andhra Pradesh",
        "rajasthan": "Rajasthan",
        "rj": "Rajasthan",
        "west bengal": "West Bengal",
        "wb": "West Bengal",
        "chhattisgarh": "Chhattisgarh",
        "cg": "Chhattisgarh",
        "odisha": "Odisha",
        "orissa": "Odisha",
        "jharkhand": "Jharkhand",
        "jh": "Jharkhand",
        "haryana": "Haryana",
        "hr": "Haryana",
        "punjab": "Punjab",
        "pb": "Punjab",
        "goa": "Goa",
        "arunachal pradesh": "Arunachal Pradesh",
        "assam": "Assam",
        "manipur": "Manipur",
        "meghalaya": "Meghalaya",
        "mizoram": "Mizoram",
        "nagaland": "Nagaland",
        "sikkim": "Sikkim",
        "telangana": "Telangana",
        "tg": "Telangana",
        "tripura": "Tripura",
        "uttarakhand": "Uttarakhand",
        "uk": "Uttarakhand",
        "himachal pradesh": "Himachal Pradesh",
        "hp": "Himachal Pradesh",
        "jammu and kashmir": "Jammu & Kashmir",
        "j&k": "Jammu & Kashmir",
        "ladakh": "Ladakh",
        "lakshadweep": "Lakshadweep",
        "puducherry": "Puducherry",
        "andaman and nicobar": "Andaman & Nicobar Islands",
    }
    normalized = state_map.get(state.lower().strip())
    return normalized or state.strip()


def get_column_index(headers, column_aliases):
    """Find column index by checking multiple possible names."""
    headers_lower = [h.lower().strip() for h in headers]
    for alias in column_aliases:
        for i, h in enumerate(headers_lower):
            if alias.lower() in h:
                return i
    return None


async def import_csv_file(session, csv_path):
    """Import a single CSV file."""
    print(f"\n[+] Processing: {csv_path.name}")

    orders_data = []
    customers_dict = defaultdict(lambda: {"name": None, "phone": None, "email": None, "state": None, "total_spent": 0, "orders": 0, "last_order_date": None, "first_order_date": None})

    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames or []

            # Find columns
            date_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["date"])
            order_id_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["order_id"])
            sku_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["sku"])
            qty_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["quantity"])
            amount_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["amount"])
            name_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["customer_name"])
            phone_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["phone"])
            email_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["email"])
            state_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["state"])
            status_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["status"])
            brand_col = get_column_index(headers, COLUMN_MAPPINGS["default"]["brand"])

            row_count = 0
            for row_idx, row in enumerate(reader):
                row_values = list(row.values())

                try:
                    order_id = row_values[order_id_col].strip() if order_id_col is not None else None
                    sku = row_values[sku_col].strip() if sku_col is not None else None
                    # Parse amount handling Indian number format (with commas)
                    amount_str = str(row_values[amount_col]).replace(",", "") if amount_col is not None else "0"
                    amount = float(amount_str) if amount_col is not None else 0
                    quantity = int(row_values[qty_col]) if qty_col is not None else 1
                    date_str = row_values[date_col] if date_col is not None else None
                    customer_name = row_values[name_col].strip() if name_col is not None else "Unknown"
                    phone = parse_phone(row_values[phone_col]) if phone_col is not None else None
                    email = row_values[email_col].strip() if email_col is not None else None
                    state = normalize_state_name(row_values[state_col]) if state_col is not None else None
                    status = row_values[status_col].strip() if status_col is not None else None
                    brand = row_values[brand_col].strip() if brand_col is not None else None

                    # Skip invalid rows
                    if not order_id or not sku or not customer_name:
                        continue

                    purchase_date = parse_date(date_str)

                    # Create order record
                    order_record = {
                        "amazon_order_id": order_id,
                        "sku": sku,
                        "quantity": quantity,
                        "item_price": amount,
                        "purchase_date": purchase_date,
                        "order_status": status or "DELIVERED",
                        "fulfillment_channel": "MFN",
                        "ship_state": state,
                        "sales_channel": csv_path.stem,
                        "brand": brand,
                    }
                    orders_data.append(order_record)

                    # Track customer
                    customer_key = (customer_name, phone, email, state)
                    customers_dict[customer_key]["name"] = customer_name
                    customers_dict[customer_key]["phone"] = phone
                    customers_dict[customer_key]["email"] = email
                    customers_dict[customer_key]["state"] = state
                    customers_dict[customer_key]["total_spent"] += amount
                    customers_dict[customer_key]["orders"] += 1
                    if purchase_date:
                        cur_last = customers_dict[customer_key]["last_order_date"]
                        cur_first = customers_dict[customer_key]["first_order_date"]
                        if cur_last is None or purchase_date > cur_last:
                            customers_dict[customer_key]["last_order_date"] = purchase_date
                        if cur_first is None or purchase_date < cur_first:
                            customers_dict[customer_key]["first_order_date"] = purchase_date

                    row_count += 1

                except (ValueError, IndexError) as e:
                    print(f"  [W] Row {row_idx + 2} skipped: {e}")
                    continue

        print(f"  [OK] Parsed {row_count} orders")
        return orders_data, customers_dict

    except Exception as e:
        print(f"  [!] Error reading {csv_path.name}: {e}")
        return [], {}


async def import_all_customer_data(wipe: bool = False):
    """Main import function.

    By default orders/customers/cogs are NOT wiped — rows are inserted with
    ON CONFLICT DO NOTHING so this script is safe to re-run alongside the
    SP-API sync. Pass --wipe (with a typed confirmation) only if you truly
    want to drop existing rows first.
    """
    print("\n" + "="*60)
    print("[*] CUSTOMER DATA IMPORT")
    print("="*60)

    async with SessionLocal() as session:
        try:
            if wipe:
                # Require interactive confirmation to prevent accidental data loss.
                order_count = (await session.execute(text("SELECT COUNT(*) FROM orders"))).scalar() or 0
                cust_count = (await session.execute(text("SELECT COUNT(*) FROM customers"))).scalar() or 0
                print(f"\n[!] --wipe passed. About to DELETE {order_count:,} orders, "
                      f"{cust_count:,} customers, and all cogs rows.")
                confirm = input('Type "WIPE" to confirm, anything else to abort: ').strip()
                if confirm != "WIPE":
                    print("[x] Aborted — no rows deleted.")
                    return
                print("\n[x] Clearing existing data...")
                await session.execute(text("DELETE FROM orders"))
                await session.execute(text("DELETE FROM customers"))
                await session.execute(text("DELETE FROM cogs"))
                await session.commit()
                print("   [OK] Data cleared")
            else:
                print("\n[i] Running in append/upsert mode (existing rows preserved). "
                      "Pass --wipe to force a full reset.")

            # 2. Process all CSV files
            csv_files = list(CUSTOMER_DATA_DIR.glob("*.csv"))
            if not csv_files:
                print(f"[!] No CSV files found in {CUSTOMER_DATA_DIR}")
                return

            all_orders = []
            all_customers = defaultdict(lambda: {"name": None, "phone": None, "email": None, "state": None, "total_spent": 0, "orders": 0, "last_order_date": None, "first_order_date": None})

            for csv_file in sorted(csv_files):
                orders, customers = await import_csv_file(session, csv_file)
                all_orders.extend(orders)
                for key, customer_data in customers.items():
                    for k, v in customer_data.items():
                        if k in ["total_spent", "orders"]:
                            all_customers[key][k] += v
                        elif k == "last_order_date":
                            cur = all_customers[key][k]
                            if v is not None and (cur is None or v > cur):
                                all_customers[key][k] = v
                        elif k == "first_order_date":
                            cur = all_customers[key][k]
                            if v is not None and (cur is None or v < cur):
                                all_customers[key][k] = v
                        else:
                            all_customers[key][k] = v

            # 3. Insert customers in batches
            print(f"\n[@] Inserting {len(all_customers)} unique customers...")
            customer_id_map = {}
            batch_size = 100
            batch_inserts = []

            for idx, (key, customer_data) in enumerate(all_customers.items(), 1):
                customer_id = f"CUST-{str(idx).zfill(4)}"
                customer_id_map[key] = customer_id

                batch_inserts.append({
                    "cid": customer_id,
                    "name": customer_data["name"],
                    "phone": f"91{customer_data['phone']}" if customer_data["phone"] else None,
                    "email": customer_data["email"],
                    "state": customer_data["state"],
                    "orders": customer_data["orders"],
                    "spent": round(customer_data["total_spent"], 2),
                    "last_order_date": customer_data["last_order_date"],
                })

                if len(batch_inserts) >= batch_size or idx == len(all_customers):
                    # Execute batch insert
                    for insert in batch_inserts:
                        await session.execute(
                            text("""
                                INSERT INTO customers (customer_id, name, phone, email, state, total_orders, total_spent, last_order_date)
                                VALUES (:cid, :name, :phone, :email, :state, :orders, :spent, :last_order_date)
                                ON CONFLICT (customer_id) DO NOTHING
                            """),
                            insert
                        )
                    await session.commit()
                    if idx % (batch_size * 5) == 0:
                        print(f"   [.] {idx}/{len(all_customers)} customers processed...")
                    batch_inserts = []

            print(f"   [OK] {len(all_customers)} customers imported")

            # 4. Insert orders in batches
            print(f"\n[P] Inserting {len(all_orders)} orders...")
            batch_size = 500
            batch_inserts = []

            for idx, order in enumerate(all_orders, 1):
                batch_inserts.append({
                    "oid": order["amazon_order_id"],
                    "sku": order["sku"],
                    "qty": order["quantity"],
                    "price": round(order["item_price"], 2),
                    "date": order["purchase_date"],
                    "status": order["order_status"],
                    "channel": order["fulfillment_channel"],
                    "state": order["ship_state"],
                    "sales": order["sales_channel"],
                })

                if len(batch_inserts) >= batch_size or idx == len(all_orders):
                    # Execute batch insert
                    for insert in batch_inserts:
                        await session.execute(
                            text("""
                                INSERT INTO orders
                                (amazon_order_id, sku, quantity, item_price, purchase_date, order_status,
                                 fulfillment_channel, ship_state, sales_channel)
                                VALUES (:oid, :sku, :qty, :price, :date, :status, :channel, :state, :sales)
                                ON CONFLICT (amazon_order_id, sku) DO NOTHING
                            """),
                            insert
                        )
                    await session.commit()
                    if idx % (batch_size * 2) == 0:
                        print(f"   [.] {idx}/{len(all_orders)} orders processed...")
                    batch_inserts = []

            print(f"   [OK] {len(all_orders)} orders imported")

            # 5. Generate customer insights
            print("\n[#] Generating customer insights...")

            # Create customer segments based on RFM
            await session.execute(text("""
                UPDATE customers c SET
                    notes = CASE
                        WHEN total_spent > 50000 THEN 'VIP Customer'
                        WHEN total_spent > 20000 THEN 'Premium'
                        WHEN total_orders > 5 THEN 'Loyal'
                        ELSE 'Regular'
                    END
                WHERE notes IS NULL
            """))

            await session.commit()

            # Print summary
            customer_result = await session.execute(text("SELECT COUNT(*) FROM customers"))
            order_result = await session.execute(text("SELECT COUNT(*) FROM orders"))
            revenue_result = await session.execute(text("SELECT COALESCE(SUM(item_price), 0) FROM orders"))

            total_customers = customer_result.scalar()
            total_orders = order_result.scalar()
            total_revenue = revenue_result.scalar()

            print("\n" + "="*60)
            print("[*] IMPORT SUMMARY")
            print("="*60)
            print(f"[@] Total Customers: {total_customers:,}")
            print(f"[P] Total Orders: {total_orders:,}")
            print(f"[C] Total Revenue: Rs. {total_revenue:,.2f}")
            print(f"[A] Avg Order Value: Rs. {total_revenue/max(1,total_orders):,.2f}")
            print(f"[S] Avg Orders/Customer: {total_orders/max(1,total_customers):.1f}")
            print("="*60)
            print("[OK] Import completed successfully!")

        except Exception as e:
            await session.rollback()
            print(f"[!] Import failed: {e}")
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import customer CSV data.")
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="DANGEROUS: delete all orders/customers/cogs before import. "
             "Requires interactive 'WIPE' confirmation.",
    )
    args = parser.parse_args()
    asyncio.run(import_all_customer_data(wipe=args.wipe))
