"""
Amazon Invoice PDF Extractor
=============================
Ported from amazon_invoice_extractor.ipynb — extracts invoice data from
Amazon supplier-copy PDF invoices and maps them to the PowerBISales schema.

Usage:
    from invoice_extractor import extract_invoices_from_zip, build_powerbi_row

    rows, errors = extract_invoices_from_zip(zip_bytes)
    for row in rows:
        db_row = build_powerbi_row(row, sku_meta)
"""

from __future__ import annotations

import io
import re
import zipfile
import logging
from datetime import datetime
from pathlib import Path
from typing import BinaryIO

import pdfplumber

logger = logging.getLogger("haltedb.invoice_extractor")


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def clean_amount(x: str) -> float:
    """Convert string amount to float (removes commas)."""
    return float(x.replace(",", ""))


def extract_text(pdf_source: str | Path | BinaryIO) -> str:
    """Extract full text from a PDF file (path or file-like object)."""
    text = ""
    with pdfplumber.open(pdf_source) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"
    return text


# ---------------------------------------------------------------------------
# SKU Extraction (6-pattern approach from notebook)
# ---------------------------------------------------------------------------

def extract_sku(full_text: str) -> str:
    """
    Extract SKU from Amazon invoice.
    Handles multiple formats:
    - B0xxxxxxxx ( HM0627 )
    - LG0995 | B0BNV9V36C
    - B0BNV9V36C ( 18980-28 )
    - SKU on separate line after ASIN
    - Gardena model numbers like 18315-20
    """
    # Pattern 1: ASIN followed by ( SKU ) where SKU starts with letters
    match = re.search(r"B[A-Z0-9]{9,10}\s*\(\s*([A-Z]{2}[A-Z0-9\-]+)\s*", full_text)
    if match:
        sku = match.group(1).strip()
        sku = re.sub(r"\s+\d+$", "", sku)
        return sku

    # Pattern 2: SKU BEFORE ASIN (like "LG0995 | B0BNV9V36C")
    match = re.search(r"((?:HM|LG|P)\d+(?:-[A-Z0-9]+)?)\s*\|?\s*B[A-Z0-9]{9,10}", full_text)
    if match:
        return match.group(1).strip()

    # Pattern 3: ASIN followed by ( alphanumeric-dash code )
    match = re.search(r"B[A-Z0-9]{9,10}\s*\(\s*([A-Z0-9]+-[A-Z0-9]+)\s*\)", full_text)
    if match:
        sku = match.group(1).strip()
        if not sku.startswith("₹"):
            return sku

    # Pattern 4: SKU on separate line after ASIN line
    lines = full_text.splitlines()
    for i, line in enumerate(lines):
        if re.search(r"B[A-Z0-9]{9,10}\s*\(", line):
            for j in range(i + 1, min(i + 3, len(lines))):
                next_line = lines[j].strip()
                match = re.match(r"^([A-Z]{2}[A-Z0-9\-]+)\s*\)", next_line)
                if match:
                    sku = match.group(1).strip()
                    sku = re.sub(r"\s+\d+$", "", sku)
                    return sku

    # Pattern 5: Standalone SKU with HM/LG/P prefix
    for line in full_text.splitlines():
        if any(skip in line for skip in ["Khasra", "Village", "Triplicate", "*ASSPL"]):
            continue
        match = re.search(r"\b((?:HM|LG|P)\d{3,}(?:-[A-Z0-9]+)?)\b", line)
        if match:
            sku = match.group(1)
            if re.search(r"B[A-Z0-9]{9}", line) or "₹" in line:
                return sku

    # Pattern 6: Gardena model numbers
    in_description = False
    for line in full_text.splitlines():
        if "Description" in line and ("Qty" in line or "Unit" in line):
            in_description = True
            continue
        if in_description:
            match = re.search(r"(?:Gardena|GARDENA)[^\n]*?(\d{5}-\d+)", line)
            if match:
                return match.group(1)
            if line.strip().startswith(("HSN", "TOTAL")):
                break

    return ""


# ---------------------------------------------------------------------------
# Item Row Extraction
# ---------------------------------------------------------------------------

def extract_item_row_values(full_text: str) -> tuple[float, int, float, float]:
    """
    Extract Unit Price, Quantity, Net Amount, Total Amount from invoice item table.
    Handles formats with and without discount column.
    """
    lines = [l.strip() for l in full_text.splitlines() if l.strip()]

    for line in lines:
        lower_line = line.lower()
        if lower_line.startswith(("shipping", "total", "hsn:")):
            continue

        money = re.findall(r"-?₹\s*([0-9,]+\.\d{2})", line)

        if len(money) >= 4:
            money_vals = [clean_amount(m) for m in money]

            # Find quantity: integer between ₹ values
            qty_match = re.search(r"₹[0-9,]+\.\d{2}\s+(\d+)\s+₹", line)
            quantity = int(qty_match.group(1)) if qty_match else 1

            unit_price = money_vals[0]
            total_amount = money_vals[-1]

            # Net Amount depends on format (with/without discount)
            if len(money_vals) == 5:
                net_amount = money_vals[2]  # With Discount
            elif len(money_vals) == 4:
                net_amount = money_vals[1]  # Without Discount
            else:
                net_amount = unit_price * quantity

            return unit_price, quantity, net_amount, total_amount

    return 0.0, 0, 0.0, 0.0


# ---------------------------------------------------------------------------
# Name Extraction
# ---------------------------------------------------------------------------

def _is_address_line(line: str) -> bool:
    """Check if a line looks like an address (not a name)."""
    upper = line.upper()
    if re.search(r"\b\d{6}\b", line):
        return True
    address_patterns = [
        r"\bROAD\b", r"\bSTREET\b", r"\bLANE\b", r"\bFLOOR\b", r"\bBLOCK\b",
        r"\bPLOT\b", r"\bHOUSE\b", r"\bFLAT\b", r"\bNAGAR\b", r"\bCOLONY\b",
        r"\bSECTOR\b", r"\bAPARTMENT\b", r"\bBUILDING\b", r"\bCOMPLEX\b",
        r"\bNEAR\b", r"\bOPP\b", r"\bBEHIND\b", r"\bMAIN\b", r"\bCROSS\b",
        r"\bSTATION\b", r"\bVILLA\b", r"\bAPT\b", r"\bPOST\b", r"\bP\.O\b",
        r"\bNH\s", r"\bNO\.\s*\d", r"\bNO\s*\d",
    ]
    for pattern in address_patterns:
        if re.search(pattern, upper):
            return True
    if re.match(r"^[A-Z\s]+,\s*[A-Z\s]+,\s*\d{6}$", line):
        return True
    return False


def extract_name_from_text(full_text: str) -> tuple[str, str]:
    """
    Extract Name1 and Name2 from the shipping address section.
    Handles names on PAN No line, GST line, or separate lines.
    """
    lines = full_text.splitlines()

    for i, line in enumerate(lines):
        if "Shipping Address" in line:
            for k in range(i + 1, min(i + 6, len(lines))):
                next_line = lines[k].strip()
                if not next_line:
                    continue

                # Check PAN No line
                if "PAN No" in next_line:
                    match = re.search(r"PAN No\s*:\s*[A-Z0-9]+\s+(.+)$", next_line)
                    if match:
                        name = match.group(1).strip()
                        if name and "Shipping" not in name:
                            parts = name.split()
                            if len(parts) >= 2:
                                return parts[0], " ".join(parts[1:])
                            elif len(parts) == 1:
                                return parts[0], ""
                    continue

                # Check GST Registration line
                if "GST Registration" in next_line:
                    match = re.search(r"GST Registration No\s*:\s*[A-Z0-9]+\s+(.+)$", next_line)
                    if match:
                        name = match.group(1).strip()
                        if name and len(name) > 2 and "Shipping" not in name:
                            parts = name.split()
                            if len(parts) >= 2:
                                return parts[0], " ".join(parts[1:])
                            elif len(parts) == 1:
                                return parts[0], ""
                    continue

                skip_keywords = [
                    "Dynamic QR", "State/UT", "Place of", "Order Number",
                    "Invoice", "TOTAL", "HSN",
                ]
                if any(kw in next_line for kw in skip_keywords):
                    continue
                if next_line.strip() == "IN":
                    continue
                if _is_address_line(next_line):
                    continue

                parts = next_line.split()
                if 1 <= len(parts) <= 5:
                    name1 = parts[0].rstrip(",")
                    name2 = " ".join(parts[1:]).rstrip(",") if len(parts) > 1 else ""
                    return name1, name2
            break

    return "", ""


# ---------------------------------------------------------------------------
# ASIN Extraction
# ---------------------------------------------------------------------------

def extract_asin(full_text: str) -> str:
    """Extract ASIN (B0xxxxxxxxx) from the invoice text."""
    match = re.search(r"\b(B[A-Z0-9]{9,10})\b", full_text)
    return match.group(1) if match else ""


# ---------------------------------------------------------------------------
# Order ID Extraction
# ---------------------------------------------------------------------------

def extract_order_id(full_text: str) -> str:
    """Extract Amazon Order ID from the invoice text."""
    # Pattern: Order Number : 408-xxxxxxx-xxxxxxx
    match = re.search(r"Order\s*(?:Number|No\.?|ID)\s*:?\s*(\d{3}-\d{7}-\d{7})", full_text)
    if match:
        return match.group(1)
    # Fallback: look for the pattern anywhere
    match = re.search(r"\b(\d{3}-\d{7}-\d{7})\b", full_text)
    return match.group(1) if match else ""


# ---------------------------------------------------------------------------
# Main Extraction Function
# ---------------------------------------------------------------------------

def extract_invoice_row(pdf_source: str | Path | BinaryIO, filename: str = "") -> dict:
    """Extract all fields from a single invoice PDF."""
    full_text = extract_text(pdf_source)

    # Invoice number & date
    invoice_no_match = re.search(r"Invoice Number\s*:\s*([A-Z0-9\-]+)", full_text)
    invoice_date_match = re.search(r"Invoice Date\s*:\s*([0-9\.]+)", full_text)
    invoice_no = invoice_no_match.group(1) if invoice_no_match else ""
    invoice_date = invoice_date_match.group(1) if invoice_date_match else ""

    # SKU
    sku = extract_sku(full_text)

    # ASIN
    asin = extract_asin(full_text)

    # Order ID
    order_id = extract_order_id(full_text)

    # Item values
    unit_price, quantity, net_amount, total_amount = extract_item_row_values(full_text)

    # Shipping address block
    ship_block = re.search(
        r"Shipping Address\s*:\s*(.*?)State/UT Code",
        full_text, re.DOTALL | re.IGNORECASE,
    )
    shipping_address = ""
    if ship_block:
        addr_lines = []
        for line in ship_block.group(1).splitlines():
            if not line.strip().startswith(("PAN No", "GST Registration", "Dynamic QR")):
                addr_lines.append(line.strip())
        shipping_address = "\n".join(addr_lines).strip()

    # Pincode
    pincode_match = re.search(r"\b\d{6}\b", shipping_address)
    pincode = pincode_match.group(0) if pincode_match else ""

    # City & State
    city, state = "", ""
    for line in shipping_address.splitlines():
        if pincode and pincode in line:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 3:
                city = parts[0]
                state = parts[1]

    # Name
    name1, name2 = extract_name_from_text(full_text)

    # Phone
    phone_match = re.search(r"\b[6-9]\d{9}\b", full_text)
    phone = phone_match.group(0) if phone_match else ""

    # Warehouse ID — extract from invoice number prefix (e.g., "AMD2-48" → "AMD2")
    warehouse_id = ""
    if invoice_no:
        wh_match = re.match(r"^([A-Z]+\d*)", invoice_no)
        if wh_match:
            warehouse_id = wh_match.group(1)

    return {
        "invoice_no": invoice_no,
        "file_name": filename,
        "invoice_date": invoice_date,
        "sku": sku,
        "asin": asin,
        "order_id": order_id,
        "unit_price": unit_price,
        "quantity": quantity,
        "net_amount": net_amount,
        "total_amount": total_amount,
        "shipping_address": shipping_address,
        "state": state,
        "city": city,
        "pincode": pincode,
        "name1": name1,
        "name2": name2,
        "phone": phone,
        "warehouse_id": warehouse_id,
    }


# ---------------------------------------------------------------------------
# Date Parsing
# ---------------------------------------------------------------------------

def _parse_invoice_date(date_str: str) -> datetime | None:
    """Parse invoice date from DD.MM.YYYY or similar formats."""
    if not date_str:
        return None
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def _fiscal_year_label(dt: datetime) -> str:
    """Return fiscal year label like FY2025."""
    fy_start = dt.year if dt.month >= 4 else dt.year - 1
    return f"FY{fy_start}"


def _quarter(dt: datetime) -> int:
    return ((dt.month - 1) // 3) + 1


# ---------------------------------------------------------------------------
# Map extracted row → PowerBISales schema
# ---------------------------------------------------------------------------

def build_powerbi_row(
    raw: dict,
    sku_meta: dict[str, dict[str, str | None]] | None = None,
) -> dict[str, object]:
    """
    Convert an extracted invoice row into a dict matching the
    PowerBISales INSERT columns (see sp_api.POWERBI_SALES_INSERT_PAIRS).
    """
    sku_meta = sku_meta or {}
    meta = sku_meta.get(raw.get("sku") or "", {})

    invoice_date = _parse_invoice_date(raw.get("invoice_date", ""))
    if invoice_date is None:
        invoice_date = datetime.utcnow()

    date_value = invoice_date.date().replace(day=1)
    quarter = _quarter(invoice_date)

    buyer_name = " ".join(filter(None, [raw.get("name1", ""), raw.get("name2", "")])).strip()

    return {
        "date": date_value,
        "year": invoice_date.year,
        "month_num": invoice_date.month,
        "month_name": invoice_date.strftime("%B"),
        "month_year": invoice_date.strftime("%b %Y"),
        "quarter": quarter,
        "quarter_name": f"Q{quarter}",
        "business": "",
        "invoice_number": raw.get("invoice_no") or None,
        "invoice_date": invoice_date,
        "transaction_type": "Shipment",
        "order_id": raw.get("order_id") or None,
        "quantity": raw.get("quantity", 0) or 0,
        "brand": meta.get("brand"),
        "item_description": None,
        "asin": raw.get("asin") or None,
        "sku": raw.get("sku") or None,
        "category": meta.get("category"),
        "segment": None,
        "ship_to_city": raw.get("city") or None,
        "ship_to_state": raw.get("state") or None,
        "ship_to_country": "IN",
        "ship_to_postal_code": raw.get("pincode") or None,
        "invoice_amount": raw.get("total_amount") or None,
        "principal_amount": raw.get("net_amount") or None,
        "warehouse_id": raw.get("warehouse_id") or None,
        "customer_bill_to_gstid": None,
        "buyer_name": buyer_name or None,
        "source": _fiscal_year_label(invoice_date),
        "channel": "Amazon",
    }


# ---------------------------------------------------------------------------
# ZIP Processing
# ---------------------------------------------------------------------------

def extract_invoices_from_zip(
    zip_source: bytes | BinaryIO,
) -> tuple[list[dict], list[dict]]:
    """
    Unzip in-memory and extract all PDF invoices.

    Returns:
        (rows, errors) where rows is a list of extracted invoice dicts
        and errors is a list of {"file": ..., "error": ...} dicts.
    """
    rows: list[dict] = []
    errors: list[dict] = []

    if isinstance(zip_source, bytes):
        zip_source = io.BytesIO(zip_source)

    with zipfile.ZipFile(zip_source, "r") as zf:
        pdf_names = [
            name for name in zf.namelist()
            if name.lower().endswith(".pdf") and not name.startswith("__MACOSX")
        ]

        logger.info("Found %d PDF files in ZIP", len(pdf_names))

        for idx, name in enumerate(pdf_names):
            try:
                pdf_bytes = zf.read(name)
                pdf_file = io.BytesIO(pdf_bytes)
                filename = Path(name).name  # strip nested dirs
                row = extract_invoice_row(pdf_file, filename=filename)
                rows.append(row)
            except Exception as exc:
                errors.append({"file": name, "error": str(exc)})
                logger.warning("Failed to extract %s: %s", name, exc)

            if (idx + 1) % 100 == 0:
                logger.info("  Processed %d/%d PDFs", idx + 1, len(pdf_names))

    logger.info(
        "ZIP extraction complete: %d extracted, %d failed",
        len(rows), len(errors),
    )
    return rows, errors


def extract_invoices_from_folder(
    folder_path: str | Path,
) -> tuple[list[dict], list[dict]]:
    """
    Extract all PDF invoices from a local folder.

    Returns:
        (rows, errors) where rows is a list of extracted invoice dicts
        and errors is a list of {"file": ..., "error": ...} dicts.
    """
    folder = Path(folder_path)
    if not folder.is_dir():
        raise ValueError(f"Not a directory: {folder}")

    rows: list[dict] = []
    errors: list[dict] = []

    # Collect PDFs (case-insensitive)
    pdf_files = sorted(
        set(folder.glob("*.pdf")) | set(folder.glob("*.PDF")),
        key=lambda p: p.name,
    )

    logger.info("Found %d PDF files in folder: %s", len(pdf_files), folder)

    for idx, pdf_path in enumerate(pdf_files):
        try:
            row = extract_invoice_row(str(pdf_path), filename=pdf_path.name)
            rows.append(row)
        except Exception as exc:
            errors.append({"file": pdf_path.name, "error": str(exc)})
            logger.warning("Failed to extract %s: %s", pdf_path.name, exc)

        if (idx + 1) % 100 == 0:
            logger.info("  Processed %d/%d PDFs", idx + 1, len(pdf_files))

    logger.info(
        "Folder extraction complete: %d extracted, %d failed",
        len(rows), len(errors),
    )
    return rows, errors
