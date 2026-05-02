"""One-shot: fill missing rows in product_specifications from missing_product_specs.xlsx.

Only updates columns that are NULL in the DB; never overwrites existing values.
Recomputes volumetric_weight_kg = L*W*H/5000 and chargeable_weight_kg = max(weight, vol).
"""
import asyncio
import os
from typing import Optional

import openpyxl
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

XLSX_PATH = "missing_product_specs.xlsx"


def to_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_rows():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    ws = wb["Missing specs"]
    rows = []
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        sku, asin, name, wt, l, w, h, vol = r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]
        if not sku:
            continue
        weight = to_float(wt)
        length = to_float(l)
        width = to_float(w)
        height = to_float(h)
        if weight is None and length is None and width is None and height is None:
            continue
        rows.append({
            "sku": str(sku).strip(),
            "asin": (str(asin).strip() if asin else None),
            "weight": weight,
            "length": length,
            "width": width,
            "height": height,
        })
    return rows


async def main():
    load_dotenv(".env")
    url = os.getenv("SUPABASE_URL")
    engine = create_async_engine(
        url,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )

    rows = load_rows()
    print(f"Loaded {len(rows)} candidate rows from {XLSX_PATH}")

    updated = 0
    inserted = 0
    skipped_no_change = 0
    missing_in_db = []

    async with engine.begin() as conn:
        for r in rows:
            sku = r["sku"]
            existing = (await conn.execute(
                text("""
                    SELECT sku, asin, weight_kg, length_cm, width_cm, height_cm,
                           volumetric_weight_kg, chargeable_weight_kg
                    FROM product_specifications WHERE sku = :sku
                """),
                {"sku": sku},
            )).mappings().first()

            # Only fill columns that are currently NULL.
            if existing is None:
                # Insert a new row using the xlsx values.
                weight = r["weight"]
                length = r["length"]
                width = r["width"]
                height = r["height"]
                vol = round((length * width * height) / 5000.0, 3) if (length and width and height) else None
                chargeable = None
                if weight is not None and vol is not None:
                    chargeable = max(weight, vol)
                elif weight is not None:
                    chargeable = weight
                elif vol is not None:
                    chargeable = vol

                await conn.execute(
                    text("""
                        INSERT INTO product_specifications
                            (sku, asin, weight_kg, length_cm, width_cm, height_cm,
                             volumetric_weight_kg, chargeable_weight_kg)
                        VALUES (:sku, :asin, :w, :l, :wd, :h, :vol, :ch)
                    """),
                    {"sku": sku, "asin": r["asin"], "w": weight, "l": length,
                     "wd": width, "h": height, "vol": vol, "ch": chargeable},
                )
                missing_in_db.append(sku)
                inserted += 1
                continue

            new_weight = existing["weight_kg"] if existing["weight_kg"] is not None else r["weight"]
            new_length = existing["length_cm"] if existing["length_cm"] is not None else r["length"]
            new_width = existing["width_cm"] if existing["width_cm"] is not None else r["width"]
            new_height = existing["height_cm"] if existing["height_cm"] is not None else r["height"]
            new_asin = existing["asin"] if existing["asin"] else r["asin"]

            # Skip if nothing actually changed.
            unchanged = (
                new_weight == existing["weight_kg"]
                and new_length == existing["length_cm"]
                and new_width == existing["width_cm"]
                and new_height == existing["height_cm"]
                and (new_asin == existing["asin"])
            )
            if unchanged:
                skipped_no_change += 1
                continue

            # Recompute derived fields only if the source dims/weight changed AND the
            # existing derived value is NULL. Don't overwrite existing derived values.
            new_vol = existing["volumetric_weight_kg"]
            if new_vol is None and new_length and new_width and new_height:
                new_vol = round((new_length * new_width * new_height) / 5000.0, 3)

            new_chargeable = existing["chargeable_weight_kg"]
            if new_chargeable is None:
                if new_weight is not None and new_vol is not None:
                    new_chargeable = max(new_weight, new_vol)
                elif new_weight is not None:
                    new_chargeable = new_weight
                elif new_vol is not None:
                    new_chargeable = new_vol

            await conn.execute(
                text("""
                    UPDATE product_specifications
                    SET asin = :asin,
                        weight_kg = :w,
                        length_cm = :l,
                        width_cm = :wd,
                        height_cm = :h,
                        volumetric_weight_kg = :vol,
                        chargeable_weight_kg = :ch
                    WHERE sku = :sku
                """),
                {"sku": sku, "asin": new_asin, "w": new_weight, "l": new_length,
                 "wd": new_width, "h": new_height, "vol": new_vol, "ch": new_chargeable},
            )
            updated += 1

    print(f"Updated rows : {updated}")
    print(f"Inserted rows: {inserted}  ({missing_in_db[:10]}{'...' if len(missing_in_db) > 10 else ''})")
    print(f"Skipped (already populated, nothing to fill): {skipped_no_change}")


if __name__ == "__main__":
    asyncio.run(main())
