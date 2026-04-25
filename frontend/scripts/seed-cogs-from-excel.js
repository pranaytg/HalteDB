/**
 * Seed estimated_cogs from Excel CSV files
 * ==========================================
 * Reads: Gardena, Gorilla, BKR, Velcro CSV files
 * Inserts into: estimated_cogs table (upsert by SKU)
 *
 * Run from frontend/: node scripts/seed-cogs-from-excel.js
 */

const { Pool } = require("pg");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres.nwvekllfbvcnezhapupt:RamanSir1234%40@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

/* ── Helpers ── */
function parseNum(v) {
  if (v === null || v === undefined || v === "" || v === "#N/A" || v === "#VALUE!") return 0;
  // Strip all non-numeric chars except dot and minus (handles garbled UTF-8 currency symbols)
  const s = String(v).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalizeArticleCode(v) {
  const s = String(v || "").trim().toUpperCase();
  const matches = s.match(/\d{4,6}/g);
  return matches ? matches[matches.length - 1] : s;
}

function recalc(row) {
  const importPrice = row.import_price || 0;
  const convRate = row.conversion_rate || 1;
  const customDuty = row.custom_duty || 0;
  const gstPercent = row.gst_percent || 18;
  const shippingCost = row.shipping_cost || 0;
  const margin1Pct = row.margin1_percent || 0;
  const marketingCost = row.marketing_cost || 0;
  const margin2Pct = row.margin2_percent || 0;

  const importPriceInr = importPrice * convRate;
  const baseBeforeGst = importPriceInr + customDuty;
  const gstAmount = baseBeforeGst * (gstPercent / 100);
  const finalPrice = baseBeforeGst + gstAmount + shippingCost;
  const margin1Amount = finalPrice * (margin1Pct / 100);
  const costPriceHalte = finalPrice + margin1Amount;
  const margin2Amount = (costPriceHalte + marketingCost) * (margin2Pct / 100);
  const sellingPrice = costPriceHalte + marketingCost + margin2Amount;
  const mspWithGst = sellingPrice;
  const halteSP = sellingPrice * 1.05;
  const amazonSP = sellingPrice * 1.2;
  const profitability = margin1Amount + margin2Amount;

  return {
    import_price_inr: round2(importPriceInr),
    gst_amount: round2(gstAmount),
    final_price: round2(finalPrice),
    margin1_amount: round2(margin1Amount),
    cost_price_halte: round2(costPriceHalte),
    margin2_amount: round2(margin2Amount),
    selling_price: round2(sellingPrice),
    msp_with_gst: round2(mspWithGst),
    halte_selling_price: round2(halteSP),
    amazon_selling_price: round2(amazonSP),
    profitability: round2(profitability),
  };
}

function readCSV(filename) {
  const filePath = path.resolve(__dirname, "../../Excel", filename);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function buildVelcroCpLookup() {
  const rows = readCSV("GORILLA RS MASTER FILE.xlsx - CP.csv");
  const map = new Map();

  for (const r of rows) {
    const code = normalizeArticleCode(r[1]);
    const usdPrice = parseNum(r[4]);
    const costInclGst = parseNum(r[9]);
    if (!code || (usdPrice <= 0 && costInclGst <= 0)) continue;

    map.set(code, {
      usdPrice,
      costInclGst,
      category: String(r[6] || "").trim(),
    });
  }

  return map;
}

function extractVelcroCostAndTax(row) {
  const col11 = parseNum(row[11]);
  const col12 = parseNum(row[12]);
  const col13 = parseNum(row[13]);

  // Some later Velcro rows are shifted left by one column, so GST lands in col 12
  // and the landed cost moves to col 11.
  if (col12 > 0 && col12 <= 28 && col13 > 28) {
    return { cost: col11, taxPct: col12 };
  }

  const taxPct = col13 > 0 && col13 <= 28 ? col13 : (col12 > 0 && col12 <= 28 ? col12 : 18);
  return { cost: col12, taxPct };
}

/* ── Parsers per brand ── */

function parseGardena() {
  const rows = readCSV("GARDENA FILE RS Master Final.xlsx - MASTER.csv");
  const items = [];
  // Data starts at row 2 (rows 0,1 are headers)
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const sku = String(r[1] || "").trim();
    if (!sku || !sku.startsWith("LG")) continue;

    const euroPrice = parseNum(r[5]); // "2025 price in Euro"
    const landingCost = parseNum(r[6]); // "New Landing Cost 01.12.25" (EUR × 105)
    const woTaxCost = parseNum(r[11]); // "W/O TAX COST"
    let taxPct = parseNum(r[12]); // TAX percentage
    if (taxPct > 28 || taxPct <= 0) taxPct = 18;

    // Euro price available → use EUR as import currency with rate 105
    // Landing cost = euroPrice × 105
    // Custom duty covers any difference between simple multiplication and actual landing cost
    const convRate = 105;
    const importPriceInr = euroPrice > 0 ? euroPrice * convRate : landingCost;
    const customDuty = landingCost > 0 && euroPrice > 0 ? round2(landingCost - importPriceInr) : 0;

    items.push({
      sku,
      article_number: String(r[3] || "").trim(),
      brand: "GARDENA",
      category: String(r[2] || "").trim(),
      import_price: euroPrice > 0 ? euroPrice : landingCost,
      import_currency: euroPrice > 0 ? "EUR" : "INR",
      conversion_rate: euroPrice > 0 ? convRate : 1,
      custom_duty: Math.max(0, customDuty),
      gst_percent: taxPct > 0 ? taxPct : 18,
      shipping_cost: 0,
      margin1_percent: 20,
      marketing_cost: 0,
      margin2_percent: 15,
    });
  }
  return items;
}

function parseGorilla() {
  const rows = readCSV("GORILLA RS MASTER FILE.xlsx - Sheet1.csv");
  const items = [];
  // Data starts at row 1 (row 0 is header)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = String(r[1] || "").trim();
    if (!sku || !sku.startsWith("HM")) continue;

    const cost84 = parseNum(r[5]); // "84/H COST" (INR at rate 84)
    const priceUSD = parseNum(r[7]); // "Old PRICE $"
    const newCost90 = parseNum(r[8]); // "New COST @ 90"
    let taxPct = parseNum(r[13]); // Tax percentage
    const shipping = parseNum(r[14]); // Shipping
    if (taxPct > 28 || taxPct <= 0) taxPct = 18;

    // Use new cost @90 if available, otherwise cost84
    const baseCostInr = newCost90 > 0 && String(r[8]) !== "#N/A" ? newCost90 : cost84;
    const convRate = newCost90 > 0 && String(r[8]) !== "#N/A" ? 90 : 84;

    // Calculate custom duty as difference between actual cost and simple USD×rate
    const simpleConv = priceUSD > 0 ? priceUSD * convRate : 0;
    const customDuty = priceUSD > 0 && baseCostInr > simpleConv ? round2(baseCostInr - simpleConv) : 0;

    items.push({
      sku,
      article_number: String(r[2] || "").trim(),
      brand: "GORILLA",
      category: String(r[4] || "").trim(),
      import_price: priceUSD > 0 ? priceUSD : baseCostInr,
      import_currency: priceUSD > 0 ? "USD" : "INR",
      conversion_rate: priceUSD > 0 ? convRate : 1,
      custom_duty: Math.max(0, customDuty),
      gst_percent: taxPct > 0 ? taxPct : 18,
      shipping_cost: shipping > 0 ? shipping : 100,
      margin1_percent: 20,
      marketing_cost: 0,
      margin2_percent: 15,
    });
  }
  return items;
}

function parseBKR() {
  const rows = readCSV("BKR AGRI file RV OR.xlsx - OR PVT.csv");
  const items = [];
  // Data starts at row 1 (row 0 is header)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = String(r[0] || "").trim();
    if (!sku || sku.length < 2) continue;
    // BKR file has LG, CA, and HM prefixed SKUs
    if (!/^(LG|CA|HM)\d/i.test(sku)) continue;

    // Prefer newer "Cost Nov 25" if available, otherwise "COST" (col 13)
    const costNov25 = parseNum(r[4]);
    const baseCost = costNov25 > 0 ? costNov25 : parseNum(r[13]);
    let gstPct = parseNum(r[15]); // GST percentage
    const shipping = parseNum(r[16]); // Shipping

    if (baseCost <= 0) continue; // skip rows without cost
    if (gstPct > 28 || gstPct <= 0) gstPct = 18;

    items.push({
      sku,
      article_number: String(r[1] || "").trim(), // MODEL NO.
      brand: "BKR",
      category: "AGRI / LAWN",
      import_price: baseCost,
      import_currency: "INR",
      conversion_rate: 1,
      custom_duty: 0,
      gst_percent: gstPct > 0 ? gstPct : 18,
      shipping_cost: shipping > 0 ? shipping : 0,
      margin1_percent: 20,
      marketing_cost: 0,
      margin2_percent: 15,
    });
  }
  return items;
}

function parseVelcro() {
  const rows = readCSV("GORILLA RS MASTER FILE.xlsx - VELCRO.csv");
  const cpLookup = buildVelcroCpLookup();
  const itemsBySku = new Map();
  const defaultUsdRate = 84;
  // Data starts at row 1 (row 0 is header)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = String(r[0] || "").trim();
    if (!sku || !sku.startsWith("HM")) continue;

    const articleNumber = normalizeArticleCode(r[1]);
    const cp = cpLookup.get(articleNumber);
    const { cost, taxPct: parsedTaxPct } = extractVelcroCostAndTax(r);
    let taxPct = parsedTaxPct;
    const shipping = parseNum(r[5]); // SHIPPING

    if (cost <= 0 && !cp?.usdPrice) continue;

    const shippingCost = shipping > 0 ? shipping : 80;
    const usdPrice = cp?.usdPrice || 0;
    const sourceFinalCost = cp?.costInclGst || 0;
    const simpleUsdConversion = usdPrice * defaultUsdRate;
    const baseBeforeGst =
      usdPrice > 0 && sourceFinalCost > shippingCost
        ? (sourceFinalCost - shippingCost) / (1 + taxPct / 100)
        : simpleUsdConversion;
    const customDuty =
      usdPrice > 0
        ? Math.max(0, round2(baseBeforeGst - simpleUsdConversion))
        : 0;

    itemsBySku.set(sku, {
      sku,
      article_number: articleNumber, // CODE
      brand: "VELCRO",
      category: cp?.category || String(r[4] || "").trim() || "ORGANISATION",
      import_price: usdPrice > 0 ? usdPrice : cost,
      import_currency: "USD",
      conversion_rate: usdPrice > 0 ? defaultUsdRate : 1,
      custom_duty: customDuty,
      gst_percent: taxPct,
      shipping_cost: shippingCost,
      margin1_percent: 20,
      marketing_cost: 0,
      margin2_percent: 15,
    });
  }
  return [...itemsBySku.values()];
}

/* ── Main ── */
async function main() {
  console.log("Parsing CSV files...");
  const gardena = parseGardena();
  const gorilla = parseGorilla();
  const bkr = parseBKR();
  const velcro = parseVelcro();

  const all = [...gardena, ...gorilla, ...bkr, ...velcro];
  console.log(
    `Parsed: Gardena=${gardena.length}, Gorilla=${gorilla.length}, BKR=${bkr.length}, Velcro=${velcro.length}, Total=${all.length}`
  );

  // Ensure amazon_fee_percent column exists
  await pool.query(`
    ALTER TABLE estimated_cogs ADD COLUMN IF NOT EXISTS amazon_fee_percent FLOAT DEFAULT 15.0
  `);

  let inserted = 0;
  let updated = 0;

  for (const item of all) {
    const calcs = recalc(item);

    const query = `
      INSERT INTO estimated_cogs (
        sku, article_number, brand, category,
        import_price, import_currency, custom_duty, conversion_rate,
        import_price_inr, gst_percent, gst_amount, shipping_cost, final_price,
        margin1_percent, margin1_amount, cost_price_halte,
        marketing_cost, margin2_percent, margin2_amount, selling_price,
        msp_with_gst, halte_selling_price, amazon_selling_price, profitability,
        amazon_fee_percent, last_updated
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW()
      )
      ON CONFLICT (sku) DO UPDATE SET
        article_number=$2, brand=$3, category=$4,
        import_price=$5, import_currency=$6, custom_duty=$7, conversion_rate=$8,
        import_price_inr=$9, gst_percent=$10, gst_amount=$11, shipping_cost=$12, final_price=$13,
        margin1_percent=$14, margin1_amount=$15, cost_price_halte=$16,
        marketing_cost=$17, margin2_percent=$18, margin2_amount=$19, selling_price=$20,
        msp_with_gst=$21, halte_selling_price=$22, amazon_selling_price=$23, profitability=$24,
        amazon_fee_percent=$25, last_updated=NOW()
      RETURNING (xmax = 0) AS is_insert
    `;

    const params = [
      item.sku,
      item.article_number || null,
      item.brand || null,
      item.category || null,
      item.import_price,
      item.import_currency,
      item.custom_duty,
      item.conversion_rate,
      calcs.import_price_inr,
      item.gst_percent,
      calcs.gst_amount,
      item.shipping_cost,
      calcs.final_price,
      item.margin1_percent,
      calcs.margin1_amount,
      calcs.cost_price_halte,
      item.marketing_cost,
      item.margin2_percent,
      calcs.margin2_amount,
      calcs.selling_price,
      calcs.msp_with_gst,
      calcs.halte_selling_price,
      calcs.amazon_selling_price,
      calcs.profitability,
      15, // amazon_fee_percent default
    ];

    const result = await pool.query(query, params);
    if (result.rows[0]?.is_insert) inserted++;
    else updated++;
  }

  console.log(`Done: ${inserted} inserted, ${updated} updated.`);

  // Also sync to cogs table using final_price as the COGS
  console.log("\nSyncing to cogs table (cogs_price = final_price)...");
  const allRows = await pool.query(
    `SELECT sku, final_price FROM estimated_cogs`
  );
  let synced = 0;
  for (const row of allRows.rows) {
    await pool.query(
      `INSERT INTO cogs (sku, cogs_price, last_updated)
       VALUES ($1, $2, NOW())
       ON CONFLICT (sku) DO UPDATE SET cogs_price=$2, last_updated=NOW()`,
      [row.sku, row.final_price]
    );
    synced++;
  }
  console.log(`Synced ${synced} SKUs to cogs table.`);

  // Recalculate profit on all orders
  console.log("\nRecalculating order profits...");
  const profitResult = await pool.query(`
    UPDATE orders o SET
      cogs_price = ec.final_price,
      profit = CASE
        WHEN o.order_status IN ('Cancelled', 'Returned') THEN
          -2 * COALESCE(o.shipping_price, 100)
        ELSE
          o.item_price
          - ec.final_price
          - (o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100)
          - COALESCE(o.shipping_price, CASE WHEN o.fulfillment_channel = 'Amazon' THEN 0 ELSE 100 END)
          - COALESCE(ec.marketing_cost, 0)
      END
    FROM estimated_cogs ec
    WHERE o.sku = ec.sku
  `);
  console.log(`Recalculated profit on ${profitResult.rowCount} orders.`);

  await pool.end();
  console.log("\nAll done!");
}

main().catch((err) => {
  console.error("Error:", err);
  pool.end();
  process.exit(1);
});
