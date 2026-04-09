const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://postgres.nwvekllfbvcnezhapupt:RamanSir1234%40@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

function parseCSV(text) {
  const lines = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; cur += c; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (cur.trim()) lines.push(cur);
      cur = "";
      if (c === '\r' && text[i+1] === '\n') i++;
    } else { cur += c; }
  }
  if (cur.trim()) lines.push(cur);

  return lines.map(line => {
    const cols = [];
    let field = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) { cols.push(field.trim()); field = ""; }
      else field += c;
    }
    cols.push(field.trim());
    return cols;
  });
}

function num(s) {
  if (!s) return 0;
  s = String(s).replace(/[₹€$,\s"']/g, "");
  if (!s || s === "NA" || s === "na" || s === "N/A" || s.includes("#") || s === "x`" || s === "-" || s === "l" || s === "D" || s === "S") return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

function round2(n) { return Math.round(n * 100) / 100; }

function normalizeArticleCode(v) {
  const s = String(v || "").trim().toUpperCase();
  const matches = s.match(/\d{4,6}/g);
  return matches ? matches[matches.length - 1] : s;
}

function buildVelcroCpLookup() {
  const rows = parseCSV(fs.readFileSync("GORILLA RS MASTER FILE.xlsx - CP.csv", "utf-8"));
  const map = new Map();
  for (const r of rows) {
    const code = normalizeArticleCode(r[1]);
    const usdPrice = num(r[4]);
    const costInclGst = num(r[9]);
    if (!code || (usdPrice <= 0 && costInclGst <= 0)) continue;
    map.set(code, {
      usdPrice,
      costInclGst,
      category: (r[6] || "").trim(),
    });
  }
  return map;
}

function extractVelcroCostAndTax(row) {
  const col11 = num(row[11]);
  const col12 = num(row[12]);
  const col13 = num(row[13]);
  if (col12 > 0 && col12 <= 28 && col13 > 28) {
    return { cost: col11, gstPct: col12 };
  }
  const gstPct = col13 > 0 && col13 <= 28 ? col13 : (col12 > 0 && col12 <= 28 ? col12 : 18);
  return { cost: col12, gstPct };
}

async function main() {
  console.log("Updating brands from existing CSV files...");
  await pool.query('ALTER TABLE estimated_cogs ADD COLUMN IF NOT EXISTS brand VARCHAR(255);');

  // 1. Update BKR
  const bkrRows = parseCSV(fs.readFileSync("BKR AGRI file RV OR.xlsx - OR PVT.csv", "utf-8"));
  let bkrCount = 0;
  for (let i = 1; i < bkrRows.length; i++) {
    const sku = bkrRows[i][0]?.trim();
    const brand = bkrRows[i][3]?.trim() || "BKR";
    if (sku && sku.match(/^(LG|CA|HM)/)) {
      await pool.query('UPDATE estimated_cogs SET brand = $1 WHERE sku = $2', [brand, sku]);
      bkrCount++;
    }
  }
  console.log(`Updated ${bkrCount} BKR records with brand.`);

  // 2. Update Gardena
  const gardenaRows = parseCSV(fs.readFileSync("GARDENA FILE RS Master Final.xlsx - MASTER.csv", "utf-8"));
  let gardenaCount = 0;
  for (let i = 2; i < gardenaRows.length; i++) {
    const sku = gardenaRows[i][1]?.trim();
    if (sku && sku.match(/^(LG|HM|CA)/) && sku !== "NA" && sku !== "cx demand") {
      await pool.query('UPDATE estimated_cogs SET brand = $1 WHERE sku = $2', ['Gardena', sku]);
      gardenaCount++;
    }
  }
  console.log(`Updated ${gardenaCount} Gardena records with brand.`);

  // 3. Update Gorilla
  const gorillaRows = parseCSV(fs.readFileSync("GORILLA RS MASTER FILE.xlsx - Sheet1.csv", "utf-8"));
  let gorillaCount = 0;
  for (let i = 1; i < gorillaRows.length; i++) {
    const sku = gorillaRows[i][1]?.trim();
    if (sku && sku.startsWith("HM") && sku !== "DUPLICATE") {
      await pool.query('UPDATE estimated_cogs SET brand = $1 WHERE sku = $2', ['Gorilla', sku]);
      gorillaCount++;
    }
  }
  console.log(`Updated ${gorillaCount} Gorilla records with brand.`);

  // 4. Insert Velcro
  const velcroRows = parseCSV(fs.readFileSync("GORILLA RS MASTER FILE.xlsx - VELCRO.csv", "utf-8"));
  const velcroCp = buildVelcroCpLookup();
  const defaultUsdRate = 84;
  let velcroCount = 0;
  for (let i = 1; i < velcroRows.length; i++) {
    const r = velcroRows[i];
    const sku = (r[0] || "").trim();
    if (!sku || !sku.startsWith("HM")) continue;

    const articleNumber = normalizeArticleCode(r[1]);
    const cp = velcroCp.get(articleNumber);
    let category = cp?.category || (r[4] || "").trim();
    if (!category) category = "Organisation";
    const { cost, gstPct: parsedGstPct } = extractVelcroCostAndTax(r);
    if (cost === 0 && !cp?.usdPrice) continue;

    const shipping = num(r[5]) || 80;
    const amzPrice = num(r[7]);
    const haltePrice = num(r[10]) || num(r[11]); 
    const gstPct = parsedGstPct || 18;
    const importPrice = cp?.usdPrice > 0 ? cp.usdPrice : cost;
    const conversionRate = cp?.usdPrice > 0 ? defaultUsdRate : 1;
    const baseBeforeGst = cp?.usdPrice > 0 && cp.costInclGst > shipping
      ? (cp.costInclGst - shipping) / (1 + gstPct / 100)
      : importPrice * conversionRate;
    const customDuty = cp?.usdPrice > 0
      ? Math.max(0, round2(baseBeforeGst - (cp.usdPrice * defaultUsdRate)))
      : 0;

    const importPriceInr = round2(importPrice * conversionRate);
    const gstAmount = round2((importPriceInr + customDuty) * (gstPct / 100));
    const finalPrice = round2(importPriceInr + customDuty + gstAmount + shipping);
    const costPriceHalte = finalPrice;
    
    const sellingPrice = haltePrice || 0;
    const m1Amount = 0;
    const m1Pct = 0;
    const m2Amount = sellingPrice > 0 ? round2(Math.max(0, sellingPrice - costPriceHalte)) : 0;
    const m2Pct = costPriceHalte > 0 ? round2((m2Amount / costPriceHalte) * 100) : 0;
    const mspWithGST = round2(sellingPrice * (1 + gstPct / 100));
    const halteSP = haltePrice || sellingPrice;
    const amzSP = amzPrice || 0;

    const profitability = round2(m1Amount + m2Amount);

    await pool.query(`
      INSERT INTO estimated_cogs (
        sku, article_number, brand, category, import_price, import_currency,
        custom_duty, conversion_rate, import_price_inr,
        gst_percent, gst_amount, shipping_cost, final_price,
        margin1_percent, margin1_amount, cost_price_halte,
        marketing_cost, margin2_percent, margin2_amount,
        selling_price, msp_with_gst, halte_selling_price,
        amazon_selling_price, profitability, competitor_price
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      )
      ON CONFLICT (sku) DO UPDATE SET
        article_number=EXCLUDED.article_number, brand=EXCLUDED.brand, category=EXCLUDED.category,
        import_price=EXCLUDED.import_price, import_currency=EXCLUDED.import_currency,
        custom_duty=EXCLUDED.custom_duty, conversion_rate=EXCLUDED.conversion_rate,
        import_price_inr=EXCLUDED.import_price_inr,
        gst_percent=EXCLUDED.gst_percent, gst_amount=EXCLUDED.gst_amount,
        shipping_cost=EXCLUDED.shipping_cost, final_price=EXCLUDED.final_price,
        margin1_percent=EXCLUDED.margin1_percent, margin1_amount=EXCLUDED.margin1_amount,
        cost_price_halte=EXCLUDED.cost_price_halte,
        marketing_cost=EXCLUDED.marketing_cost, margin2_percent=EXCLUDED.margin2_percent,
        margin2_amount=EXCLUDED.margin2_amount,
        selling_price=EXCLUDED.selling_price, msp_with_gst=EXCLUDED.msp_with_gst,
        halte_selling_price=EXCLUDED.halte_selling_price,
        amazon_selling_price=EXCLUDED.amazon_selling_price,
        profitability=EXCLUDED.profitability, competitor_price=EXCLUDED.competitor_price
    `, [
      sku, articleNumber, 'Velcro', category, importPrice, 'USD',
      customDuty, conversionRate, importPriceInr,
      gstPct, gstAmount, shipping, finalPrice,
      m1Pct, m1Amount, costPriceHalte,
      0, m2Pct, m2Amount,
      sellingPrice, mspWithGST, halteSP, amzSP,
      profitability, 0
    ]);
    velcroCount++;
  }
  console.log(`Inserted/Updated ${velcroCount} Velcro records.`);

  await pool.end();
}

main().catch(console.error);
