"""Import product dimensions and actual weights from an Excel sheet.

Usage:
  python tasks/import_product_dimensions.py "/path/to/products dimensions.xlsx"
  python tasks/import_product_dimensions.py "/path/to/products dimensions.xlsx" --apply
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass
from typing import Iterable

import openpyxl
import psycopg2


DEFAULT_DATABASE_URL = (
    "postgresql://postgres.nwvekllfbvcnezhapupt:RamanSir1234%40"
    "@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
)
INCH_TO_CM = 2.54


@dataclass
class SheetSpec:
    sku: str
    weight_kg: float | None
    length_cm: float | None
    width_cm: float | None
    height_cm: float | None
    volumetric_weight_kg: float | None
    chargeable_weight_kg: float | None
    source_row: int
    package_count: int


def clean_sku(value: object) -> str:
    return str(value or "").strip().upper()


def parse_weight_kg(value: object) -> float | None:
    text = str(value or "").strip().lower()
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    if not match:
        return None

    weight = float(match.group(1))
    if re.search(r"\b(g|gm|gram|grams)\b", text) or "gram" in text:
        weight /= 1000
    elif re.search(r"\b(lb|lbs|pound|pounds)\b", text):
        weight *= 0.45359237
    elif re.search(r"\b(oz|ounce|ounces)\b", text):
        weight *= 0.0283495231

    return round(weight, 3)


def parse_dimensions_cm(value: object) -> list[tuple[float, float, float]]:
    text = str(value or "").strip().lower()
    if not text or "oos" in text:
        return []

    text = text.replace("×", "x")
    packages: list[tuple[float, float, float]] = []
    for match in re.finditer(
        r"(\d+(?:\.\d+)?)\s*(?:x|\*)\s*(\d+(?:\.\d+)?)\s*(?:x|\*)\s*(\d+(?:\.\d+)?)",
        text,
    ):
        segment_end = min(len(text), match.end() + 16)
        segment = text[match.start() : segment_end]
        values = tuple(float(part) for part in match.groups())
        if "inch" in segment or "inches" in segment or '"' in segment:
            values = tuple(part * INCH_TO_CM for part in values)
        packages.append(tuple(round(part, 3) for part in values))

    return packages


def volumetric_weight(packages: Iterable[tuple[float, float, float]]) -> float | None:
    volume = sum(length * width * height for length, width, height in packages)
    return round(volume / 5000, 3) if volume else None


def largest_package(packages: list[tuple[float, float, float]]) -> tuple[float, float, float] | None:
    if not packages:
        return None
    return max(packages, key=lambda dims: dims[0] * dims[1] * dims[2])


def read_sheet_specs(path: str) -> dict[str, SheetSpec]:
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheet = workbook.active
    specs: dict[str, SheetSpec] = {}

    for row_idx, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        sku = clean_sku(row[0] if row else None)
        if not sku:
            continue

        packages = parse_dimensions_cm(row[3] if len(row) > 3 else None)
        weight_kg = parse_weight_kg(row[5] if len(row) > 5 else None)
        if not packages and weight_kg is None:
            continue

        display_dims = largest_package(packages)
        vol_weight = volumetric_weight(packages)
        chargeable = None
        if weight_kg is not None or vol_weight is not None:
            chargeable = round(max(weight_kg or 0, vol_weight or 0), 3)

        candidate = SheetSpec(
            sku=sku,
            weight_kg=weight_kg,
            length_cm=round(display_dims[0], 3) if display_dims else None,
            width_cm=round(display_dims[1], 3) if display_dims else None,
            height_cm=round(display_dims[2], 3) if display_dims else None,
            volumetric_weight_kg=vol_weight,
            chargeable_weight_kg=chargeable,
            source_row=row_idx,
            package_count=len(packages),
        )

        # Prefer the duplicate row with the most complete measurements.
        previous = specs.get(sku)
        previous_score = 0 if previous is None else sum(
            value is not None
            for value in (previous.weight_kg, previous.length_cm, previous.width_cm, previous.height_cm)
        )
        candidate_score = sum(
            value is not None
            for value in (candidate.weight_kg, candidate.length_cm, candidate.width_cm, candidate.height_cm)
        )
        if previous is None or candidate_score >= previous_score:
            specs[sku] = candidate

    return specs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx_path")
    parser.add_argument("--apply", action="store_true", help="Update the database")
    args = parser.parse_args()

    sheet_specs = read_sheet_specs(args.xlsx_path)
    conn = psycopg2.connect(os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL), sslmode="require")
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT sku, weight_kg, length_cm, width_cm, height_cm
                FROM product_specifications
                """
            )
            existing = {clean_sku(row[0]): row for row in cur.fetchall()}

            matched = [spec for sku, spec in sheet_specs.items() if sku in existing]
            skipped = sorted(set(sheet_specs) - set(existing))
            changed = []
            for spec in matched:
                current = existing[spec.sku]
                current_values = tuple(round(float(v), 3) if v is not None else None for v in current[1:])
                new_values = (spec.weight_kg, spec.length_cm, spec.width_cm, spec.height_cm)
                if current_values != new_values:
                    changed.append(spec)

            print(f"Parsed usable spreadsheet rows: {len(sheet_specs)}")
            print(f"Matched SKUs in product_specifications: {len(matched)}")
            print(f"Rows with changed weight/dimensions: {len(changed)}")
            print(f"Skipped SKUs not in product_specifications: {len(skipped)}")
            if skipped:
                print("Skipped sample:", ", ".join(skipped[:20]))

            multi_box = [spec for spec in changed if spec.package_count > 1]
            if multi_box:
                print("Multi-box SKUs with summed volumetric weight:", ", ".join(spec.sku for spec in multi_box))

            if not args.apply:
                print("Dry run only. Re-run with --apply to update the database.")
                return

            for spec in changed:
                cur.execute(
                    """
                    UPDATE product_specifications
                    SET weight_kg = %s,
                        length_cm = %s,
                        width_cm = %s,
                        height_cm = %s,
                        volumetric_weight_kg = %s,
                        chargeable_weight_kg = %s,
                        last_updated = NOW()
                    WHERE sku = %s
                    """,
                    (
                        spec.weight_kg,
                        spec.length_cm,
                        spec.width_cm,
                        spec.height_cm,
                        spec.volumetric_weight_kg,
                        spec.chargeable_weight_kg,
                        spec.sku,
                    ),
                )

            print(f"Updated product_specifications rows: {len(changed)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
