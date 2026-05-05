import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/* ──────────────────────────────────────────────────────────
   Recalculate all derived fields server-side
   ────────────────────────────────────────────────────────── */
function recalc(row: Record<string, number | string | null | undefined>) {
  const importPrice    = Number(row.import_price) || 0;
  const currency       = String(row.import_currency || "USD").toUpperCase();
  // INR items need no conversion — enforce rate = 1
  const convRate       = currency === "INR" ? 1 : (Number(row.conversion_rate) || 83);
  const customDuty     = Number(row.custom_duty) || 0;
  const gstPercent     = row.gst_percent != null ? Number(row.gst_percent) : 18;
  const shippingCost   = Number(row.shipping_cost) || 0;
  const margin1Pct     = Number(row.margin1_percent) || 0;
  const marketingPct   = row.marketing_cost != null && Number.isFinite(Number(row.marketing_cost))
    ? Number(row.marketing_cost)
    : 2;
  const margin2Pct     = Number(row.margin2_percent) || 0;
  const amazonFeePct   = Number(row.amazon_fee_percent) || 15;
  const amazonMarkupPct = row.amazon_markup_percent != null && Number.isFinite(Number(row.amazon_markup_percent))
    ? Number(row.amazon_markup_percent)
    : 15;

  const importPriceInr = importPrice * convRate;
  const baseBeforeGst  = importPriceInr + customDuty;
  const gstAmount      = baseBeforeGst * (gstPercent / 100);
  const finalPrice     = baseBeforeGst + gstAmount + shippingCost;
  const margin1Amount  = finalPrice * (margin1Pct / 100);
  const costPriceHalte = finalPrice + margin1Amount;
  const margin2Amount  = costPriceHalte * (margin2Pct / 100);
  const sellingPrice   = costPriceHalte + margin2Amount;
  const mspWithGst     = sellingPrice;
  const halteSP        = sellingPrice * 1.05;

  // Amazon SP is derived: Halte SP * (1 + amazon_markup_percent/100)
  const amazonSP = halteSP * (1 + amazonMarkupPct / 100);

  // Marketing is stored as a percentage and applied only in profitability.
  const amazonFee      = amazonSP * (amazonFeePct / 100);
  const marketingCost  = amazonSP * (marketingPct / 100);
  const profitability  = amazonSP - finalPrice - amazonFee - shippingCost - marketingCost;
  // Profit % on Amazon Selling Price
  const profitPercent  = amazonSP > 0 ? (profitability / amazonSP) * 100 : 0;

  return {
    import_price_inr:      roundInt(importPriceInr),
    gst_amount:            roundInt(gstAmount),
    final_price:           roundInt(finalPrice),
    margin1_amount:        roundInt(margin1Amount),
    cost_price_halte:      roundInt(costPriceHalte),
    margin2_amount:        roundInt(margin2Amount),
    selling_price:         roundInt(sellingPrice),
    msp_with_gst:          roundInt(mspWithGst),
    halte_selling_price:   roundInt(halteSP),
    amazon_markup_percent: round1(amazonMarkupPct),
    amazon_selling_price:  roundInt(amazonSP),
    profitability:         roundInt(profitability),
    profit_percent:        round1(profitPercent),
  };
}

function roundInt(n: number) { return Math.round(n); }
function round1(n: number) { return Math.round(n * 10) / 10; }

/* ──────────────────────────────────────────────────────────
   GET — list all estimated_cogs entries
   ────────────────────────────────────────────────────────── */
export async function GET() {
  try {
    const result = await pool.query(`SELECT * FROM estimated_cogs ORDER BY sku ASC`);
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    console.error("EstimatedCogs GET error:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

/* ──────────────────────────────────────────────────────────
   POST — create or update a single row (upsert by SKU)
   ────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sku = body.sku?.trim();
    if (!sku) return NextResponse.json({ error: "SKU required" }, { status: 400 });

    const calcs = recalc(body);

    const query = `
      INSERT INTO estimated_cogs (
        sku, article_number, brand, category,
        import_price, import_currency, custom_duty, conversion_rate,
        import_price_inr, gst_percent, gst_amount, shipping_cost, final_price,
        margin1_percent, margin1_amount, cost_price_halte,
        marketing_cost, margin2_percent, margin2_amount, selling_price,
        msp_with_gst, halte_selling_price, amazon_markup_percent, amazon_selling_price, profitability,
        amazon_fee_percent, profit_percent, last_updated
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW()
      )
      ON CONFLICT (sku) DO UPDATE SET
        article_number=$2, brand=$3, category=$4,
        import_price=$5, import_currency=$6, custom_duty=$7, conversion_rate=$8,
        import_price_inr=$9, gst_percent=$10, gst_amount=$11, shipping_cost=$12, final_price=$13,
        margin1_percent=$14, margin1_amount=$15, cost_price_halte=$16,
        marketing_cost=$17, margin2_percent=$18, margin2_amount=$19, selling_price=$20,
        msp_with_gst=$21, halte_selling_price=$22, amazon_markup_percent=$23, amazon_selling_price=$24, profitability=$25,
        amazon_fee_percent=$26, profit_percent=$27, last_updated=NOW()
      RETURNING *
    `;

    const currency = (body.import_currency || "USD").toUpperCase();
    const conversionRate = currency === "INR" ? 1 : (Number(body.conversion_rate) || 83);

    const params = [
      sku,
      body.article_number || null,
      body.brand || null,
      body.category || null,
      Number(body.import_price) || 0,
      currency,
      Number(body.custom_duty) || 0,
      conversionRate,
      calcs.import_price_inr,
      body.gst_percent != null ? Number(body.gst_percent) : 18,
      calcs.gst_amount,
      Number(body.shipping_cost) || 0,
      calcs.final_price,
      Number(body.margin1_percent) || 0,
      calcs.margin1_amount,
      calcs.cost_price_halte,
      body.marketing_cost != null && Number.isFinite(Number(body.marketing_cost)) ? Number(body.marketing_cost) : 2,
      Number(body.margin2_percent) || 0,
      calcs.margin2_amount,
      calcs.selling_price,
      calcs.msp_with_gst,
      calcs.halte_selling_price,
      calcs.amazon_markup_percent,
      calcs.amazon_selling_price,
      calcs.profitability,
      Number(body.amazon_fee_percent) || 15,
      calcs.profit_percent,
    ];

    const result = await pool.query(query, params);
    return NextResponse.json({ saved: result.rows[0] });
  } catch (error) {
    console.error("EstimatedCogs POST error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

/* ──────────────────────────────────────────────────────────
   PUT — special actions: mass_currency_update | sync_cogs
   ────────────────────────────────────────────────────────── */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;

    /* ── Mass Currency Update ── */
    if (action === "mass_currency_update") {
      const conversionRate = Number(body.conversion_rate);
      const currency = body.currency || "USD";

      if (!conversionRate || conversionRate <= 0)
        return NextResponse.json({ error: "Valid conversion rate required" }, { status: 400 });

      // ONLY update rows that match the selected currency
      const matchingRows = await pool.query(
        `SELECT * FROM estimated_cogs WHERE import_currency = $1`, [currency]
      );
      let updated = 0;

      for (const row of matchingRows.rows) {
        // Keep the same currency, only update conversion_rate
        const newRow = { ...row, conversion_rate: conversionRate };
        const calcs = recalc(newRow);
        await pool.query(`
          UPDATE estimated_cogs SET
            conversion_rate=$1,
            import_price_inr=$2, gst_amount=$3, final_price=$4,
            margin1_amount=$5, cost_price_halte=$6,
            margin2_amount=$7, selling_price=$8,
            msp_with_gst=$9, halte_selling_price=$10, amazon_markup_percent=$11, amazon_selling_price=$12,
            profitability=$13, profit_percent=$14, last_updated=NOW()
          WHERE id=$15
        `, [
          conversionRate,
          calcs.import_price_inr, calcs.gst_amount, calcs.final_price,
          calcs.margin1_amount, calcs.cost_price_halte,
          calcs.margin2_amount, calcs.selling_price,
          calcs.msp_with_gst, calcs.halte_selling_price, calcs.amazon_markup_percent, calcs.amazon_selling_price,
          calcs.profitability, calcs.profit_percent, row.id,
        ]);
        updated++;
      }

      return NextResponse.json({
        message: `Updated ${updated} ${currency} SKUs with rate ${conversionRate} (${matchingRows.rows.length} total ${currency} items)`,
        updated,
      });
    }

    /* ── Sync to COGS table ── */
    if (action === "sync_cogs") {
      const result = await pool.query(`
        INSERT INTO cogs (sku, cogs_price, last_updated)
        SELECT sku, COALESCE(final_price, 0), NOW()
        FROM estimated_cogs
        ON CONFLICT (sku) DO UPDATE SET
          cogs_price = EXCLUDED.cogs_price,
          last_updated = NOW()
      `);

      return NextResponse.json({
        message: `Synced ${result.rowCount} SKUs to COGS table.`,
        synced: result.rowCount,
      });
    }

    /* ── Recalculate All Rows ── */
    if (action === "recalc_all") {
      const allRows = await pool.query(`SELECT * FROM estimated_cogs`);
      let updated = 0;

      for (const row of allRows.rows) {
        const calcs = recalc(row);
        await pool.query(`
          UPDATE estimated_cogs SET
            import_price_inr=$1, gst_amount=$2, final_price=$3,
            margin1_amount=$4, cost_price_halte=$5,
            margin2_amount=$6, selling_price=$7,
            msp_with_gst=$8, halte_selling_price=$9, amazon_markup_percent=$10, amazon_selling_price=$11,
            profitability=$12, profit_percent=$13, last_updated=NOW()
          WHERE id=$14
        `, [
          calcs.import_price_inr, calcs.gst_amount, calcs.final_price,
          calcs.margin1_amount, calcs.cost_price_halte,
          calcs.margin2_amount, calcs.selling_price,
          calcs.msp_with_gst, calcs.halte_selling_price, calcs.amazon_markup_percent, calcs.amazon_selling_price,
          calcs.profitability, calcs.profit_percent, row.id,
        ]);
        updated++;
      }

      return NextResponse.json({
        message: `Recalculated ${updated} SKUs with corrected formulas`,
        updated,
      });
    }

    /* ── Mass Update with filters ── */
    if (action === "mass_update") {
      const ALLOWED_FIELDS: Record<string, "number"> = {
        import_price: "number",
        custom_duty: "number",
        conversion_rate: "number",
        gst_percent: "number",
        shipping_cost: "number",
        margin1_percent: "number",
        marketing_cost: "number",
        margin2_percent: "number",
        amazon_fee_percent: "number",
        amazon_markup_percent: "number",
      };

      const field = String(body.field || "");
      if (!ALLOWED_FIELDS[field]) {
        return NextResponse.json({ error: `Field "${field}" is not updatable in bulk` }, { status: 400 });
      }

      const rawValue = body.value;
      const value = Number(rawValue);
      const isDryRun = !!body.dry_run;

      // Value is only required for the actual write — dry run just counts matches
      if (!isDryRun) {
        if (rawValue === "" || rawValue == null || !Number.isFinite(value)) {
          return NextResponse.json({ error: "Valid numeric value required" }, { status: 400 });
        }
        if (value < 0) {
          return NextResponse.json({ error: "Value cannot be negative" }, { status: 400 });
        }
        if ((field.endsWith("_percent") || field === "marketing_cost") && value > 1000) {
          return NextResponse.json({ error: "Percentage value seems too large" }, { status: 400 });
        }
        if (field === "conversion_rate" && value <= 0) {
          return NextResponse.json({ error: "Conversion rate must be > 0" }, { status: 400 });
        }
      }

      // Build WHERE clause from optional filters
      const filters = body.filters || {};
      const where: string[] = [];
      const params: (string | number)[] = [];
      let p = 1;

      if (filters.brand) { where.push(`brand = $${p++}`); params.push(String(filters.brand)); }
      if (filters.category) { where.push(`category = $${p++}`); params.push(String(filters.category)); }
      if (filters.currency) { where.push(`UPPER(import_currency) = $${p++}`); params.push(String(filters.currency).toUpperCase()); }
      if (filters.sku_contains) { where.push(`sku ILIKE $${p++}`); params.push(`%${String(filters.sku_contains)}%`); }

      // Skip INR rows when updating conversion_rate (rate is forced to 1 anyway)
      if (field === "conversion_rate") {
        where.push(`UPPER(import_currency) <> 'INR'`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const matchingRows = await pool.query(
        `SELECT * FROM estimated_cogs ${whereSql}`, params
      );

      if (matchingRows.rows.length === 0) {
        return NextResponse.json({ error: "No SKUs match the selected filters" }, { status: 400 });
      }

      // Dry-run mode: return count + list of matching SKUs (no value needed)
      if (isDryRun) {
        return NextResponse.json({
          matched: matchingRows.rows.length,
          skus: matchingRows.rows.map(r => r.sku),
          message: `${matchingRows.rows.length} SKU(s) would be updated`,
        });
      }

      let updated = 0;
      // `amazon_markup_percent` is also a recalc output, so when the user
      // mass-updates that field we must skip the recalc-driven setter to
      // avoid a duplicate SET on the same column (Postgres rejects that).
      const skipMarkupSetter = field === "amazon_markup_percent";
      for (const row of matchingRows.rows) {
        const newRow = { ...row, [field]: value };
        const calcs = recalc(newRow);
        if (skipMarkupSetter) {
          await pool.query(
            `UPDATE estimated_cogs SET
              amazon_markup_percent=$1,
              import_price_inr=$2, gst_amount=$3, final_price=$4,
              margin1_amount=$5, cost_price_halte=$6,
              margin2_amount=$7, selling_price=$8,
              msp_with_gst=$9, halte_selling_price=$10, amazon_selling_price=$11,
              profitability=$12, profit_percent=$13, last_updated=NOW()
            WHERE id=$14`,
            [
              value,
              calcs.import_price_inr, calcs.gst_amount, calcs.final_price,
              calcs.margin1_amount, calcs.cost_price_halte,
              calcs.margin2_amount, calcs.selling_price,
              calcs.msp_with_gst, calcs.halte_selling_price, calcs.amazon_selling_price,
              calcs.profitability, calcs.profit_percent, row.id,
            ]
          );
        } else {
          await pool.query(
            `UPDATE estimated_cogs SET
              ${field}=$1,
              import_price_inr=$2, gst_amount=$3, final_price=$4,
              margin1_amount=$5, cost_price_halte=$6,
              margin2_amount=$7, selling_price=$8,
              msp_with_gst=$9, halte_selling_price=$10, amazon_markup_percent=$11, amazon_selling_price=$12,
              profitability=$13, profit_percent=$14, last_updated=NOW()
            WHERE id=$15`,
            [
              value,
              calcs.import_price_inr, calcs.gst_amount, calcs.final_price,
              calcs.margin1_amount, calcs.cost_price_halte,
              calcs.margin2_amount, calcs.selling_price,
              calcs.msp_with_gst, calcs.halte_selling_price, calcs.amazon_markup_percent, calcs.amazon_selling_price,
              calcs.profitability, calcs.profit_percent, row.id,
            ]
          );
        }
        updated++;
      }

      return NextResponse.json({
        message: `Mass updated ${field} = ${value} on ${updated} SKU(s)`,
        updated,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("EstimatedCogs PUT error:", error);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

/* ──────────────────────────────────────────────────────────
   DELETE — remove by SKU
   ────────────────────────────────────────────────────────── */
export async function DELETE(req: NextRequest) {
  try {
    const { sku } = await req.json();
    if (!sku) return NextResponse.json({ error: "SKU required" }, { status: 400 });
    await pool.query(`DELETE FROM estimated_cogs WHERE sku = $1`, [sku]);
    return NextResponse.json({ deleted: sku });
  } catch (error) {
    console.error("EstimatedCogs DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
