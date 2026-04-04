import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/* ──────────────────────────────────────────────────────────
   Recalculate all derived fields server-side
   ────────────────────────────────────────────────────────── */
function recalc(row: Record<string, number | string | null>) {
  const importPrice    = Number(row.import_price) || 0;
  const convRate       = Number(row.conversion_rate) || 83;
  const customDuty     = Number(row.custom_duty) || 0;
  const gstPercent     = Number(row.gst_percent) || 18;
  const shippingCost   = Number(row.shipping_cost) || 0;
  const margin1Pct     = Number(row.margin1_percent) || 0;
  const marketingCost  = Number(row.marketing_cost) || 0;
  const margin2Pct     = Number(row.margin2_percent) || 0;

  const importPriceInr = importPrice * convRate;
  const baseBeforeGst  = importPriceInr + customDuty;
  const gstAmount      = baseBeforeGst * (gstPercent / 100);
  const finalPrice     = baseBeforeGst + gstAmount + shippingCost;
  const margin1Amount  = finalPrice * (margin1Pct / 100);
  const costPriceHalte = finalPrice + margin1Amount;
  const margin2Amount  = (costPriceHalte + marketingCost) * (margin2Pct / 100);
  const sellingPrice   = costPriceHalte + marketingCost + margin2Amount;
  const mspWithGst     = sellingPrice * (1 + gstPercent / 100);
  const halteSP        = mspWithGst * 1.05;
  const amazonSP       = mspWithGst * 1.20;
  const profitability  = margin1Amount + margin2Amount;

  return {
    import_price_inr:      round2(importPriceInr),
    gst_amount:            round2(gstAmount),
    final_price:           round2(finalPrice),
    margin1_amount:        round2(margin1Amount),
    cost_price_halte:      round2(costPriceHalte),
    margin2_amount:        round2(margin2Amount),
    selling_price:         round2(sellingPrice),
    msp_with_gst:          round2(mspWithGst),
    halte_selling_price:   round2(halteSP),
    amazon_selling_price:  round2(amazonSP),
    profitability:         round2(profitability),
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }

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
        msp_with_gst, halte_selling_price, amazon_selling_price, profitability,
        last_updated
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW()
      )
      ON CONFLICT (sku) DO UPDATE SET
        article_number=$2, brand=$3, category=$4,
        import_price=$5, import_currency=$6, custom_duty=$7, conversion_rate=$8,
        import_price_inr=$9, gst_percent=$10, gst_amount=$11, shipping_cost=$12, final_price=$13,
        margin1_percent=$14, margin1_amount=$15, cost_price_halte=$16,
        marketing_cost=$17, margin2_percent=$18, margin2_amount=$19, selling_price=$20,
        msp_with_gst=$21, halte_selling_price=$22, amazon_selling_price=$23, profitability=$24,
        last_updated=NOW()
      RETURNING *
    `;

    const params = [
      sku,
      body.article_number || null,
      body.brand || null,
      body.category || null,
      Number(body.import_price) || 0,
      body.import_currency || "USD",
      Number(body.custom_duty) || 0,
      Number(body.conversion_rate) || 83,
      calcs.import_price_inr,
      Number(body.gst_percent) || 18,
      calcs.gst_amount,
      Number(body.shipping_cost) || 0,
      calcs.final_price,
      Number(body.margin1_percent) || 0,
      calcs.margin1_amount,
      calcs.cost_price_halte,
      Number(body.marketing_cost) || 0,
      Number(body.margin2_percent) || 0,
      calcs.margin2_amount,
      calcs.selling_price,
      calcs.msp_with_gst,
      calcs.halte_selling_price,
      calcs.amazon_selling_price,
      calcs.profitability,
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
            msp_with_gst=$9, halte_selling_price=$10, amazon_selling_price=$11,
            profitability=$12, last_updated=NOW()
          WHERE id=$13
        `, [
          conversionRate,
          calcs.import_price_inr, calcs.gst_amount, calcs.final_price,
          calcs.margin1_amount, calcs.cost_price_halte,
          calcs.margin2_amount, calcs.selling_price,
          calcs.msp_with_gst, calcs.halte_selling_price, calcs.amazon_selling_price,
          calcs.profitability, row.id,
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
      // For each estimated_cogs row, upsert into cogs table with cogs_price = cost_price_halte
      const allRows = await pool.query(`SELECT sku, cost_price_halte FROM estimated_cogs`);
      let synced = 0;
      let ordersRecalc = 0;

      for (const row of allRows.rows) {
        const cogsPrice = Number(row.cost_price_halte) || 0;

        // Upsert into cogs
        await pool.query(`
          INSERT INTO cogs (sku, cogs_price, last_updated)
          VALUES ($1, $2, NOW())
          ON CONFLICT (sku) DO UPDATE SET cogs_price=$2, last_updated=NOW()
        `, [row.sku, cogsPrice]);

        // Recalculate profit: item_price - cogs - shipping
        // FBA (Amazon fulfilled): uses shipping_price from report
        // Self-fulfilled: uses Rs 100 flat
        const ordResult = await pool.query(`
          UPDATE orders SET cogs_price=$1,
            profit = item_price - $1 - CASE
              WHEN fulfillment_channel = 'Amazon' AND COALESCE(shipping_price, 0) > 0
                THEN shipping_price
              ELSE 100
            END
          WHERE sku=$2
        `, [cogsPrice, row.sku]);
        ordersRecalc += ordResult.rowCount || 0;
        synced++;
      }

      return NextResponse.json({
        message: `Synced ${synced} SKUs to COGS table. ${ordersRecalc} orders recalculated (profit = invoice - COGS - shipping).`,
        synced,
        ordersRecalculated: ordersRecalc,
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
