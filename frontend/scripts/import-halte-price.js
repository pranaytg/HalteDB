/**
 * Import Halte website prices from HaltePrice.xlsx.
 *
 * The workbook is expected to be a product feed where:
 *   - "id" is the SKU
 *   - "price" is the Halte website price, e.g. "INR 4,999"
 *
 * By default this runs as a dry run. Pass --apply to update cogs.halte_price.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const APPLY = process.argv.includes("--apply");
const WORKBOOK_PATH = path.resolve(__dirname, "../../HaltePrice.xlsx");

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return env;

      const eq = trimmed.indexOf("=");
      if (eq === -1) return env;

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
      return env;
    }, {});
}

function getConnectionString() {
  const env = { ...readDotEnv(path.resolve(__dirname, "../../.env")), ...process.env };
  if (env.DATABASE_URL) return env.DATABASE_URL;

  if (env.SUPABASE_URL) {
    return env.SUPABASE_URL.replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
  }

  throw new Error("DATABASE_URL or SUPABASE_URL is required");
}

function parsePrice(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;

  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function readPrices() {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    throw new Error(`Workbook not found: ${WORKBOOK_PATH}`);
  }

  const workbook = XLSX.readFile(WORKBOOK_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const prices = new Map();
  const skipped = [];

  for (const row of rows) {
    const sku = String(row.id || "").trim();
    const price = parsePrice(row.price);

    if (!sku || price === null) {
      skipped.push({ sku, price: row.price });
      continue;
    }

    prices.set(sku, price);
  }

  return { prices, skipped, rowCount: rows.length };
}

async function main() {
  const { prices, skipped, rowCount } = readPrices();
  const pool = new Pool({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });

  try {
    const columnResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cogs'
          AND column_name = 'halte_price'
      ) AS exists
    `);
    let hasHaltePriceColumn = Boolean(columnResult.rows[0]?.exists);

    if (!hasHaltePriceColumn && APPLY) {
      await pool.query("ALTER TABLE cogs ADD COLUMN IF NOT EXISTS halte_price DOUBLE PRECISION");
      hasHaltePriceColumn = true;
    }

    const priceSelect = hasHaltePriceColumn
      ? "c.halte_price"
      : "NULL::double precision AS halte_price";

    const dbRows = await pool.query(`
      SELECT
        c.sku,
        ${priceSelect}
      FROM cogs c
      WHERE c.sku = ANY($1::text[])
      ORDER BY c.sku
    `, [[...prices.keys()]]);

    const matched = dbRows.rows;
    const changed = matched.filter((row) => {
      const nextPrice = prices.get(row.sku);
      const currentPrice =
        row.halte_price === null || row.halte_price === undefined
          ? null
          : Number(row.halte_price);

      return currentPrice === null || Math.abs(currentPrice - nextPrice) >= 0.01;
    });
    const matchedSkus = new Set(matched.map((row) => row.sku));
    const workbookOnly = [...prices.keys()].filter((sku) => !matchedSkus.has(sku));

    console.log(`Workbook rows: ${rowCount}`);
    console.log(`Valid prices: ${prices.size}`);
    console.log(`Skipped rows: ${skipped.length}`);
    console.log(`Matched COGS SKUs: ${matched.length}`);
    console.log(`Matched rows needing update: ${changed.length}`);
    console.log(`Workbook SKUs not in COGS: ${workbookOnly.length}`);
    console.log(`cogs.halte_price column exists: ${hasHaltePriceColumn ? "yes" : "no"}`);

    if (changed.length > 0) {
      console.log("\nSample changes:");
      for (const row of changed.slice(0, 10)) {
        const before = row.halte_price == null ? "-" : row.halte_price;
        console.log(`  ${row.sku}: ${before} -> ${prices.get(row.sku)}`);
      }
    }

    if (!APPLY) {
      console.log("\nDry run only. Re-run with --apply to update cogs.halte_price.");
      return;
    }

    await pool.query("BEGIN");

    for (const row of changed) {
      const price = prices.get(row.sku);
      await pool.query(
        `
          UPDATE cogs
          SET halte_price = $2,
              last_updated = NOW()
          WHERE sku = $1
        `,
        [row.sku, price]
      );
    }
    await pool.query("COMMIT");

    console.log(`\nUpdated ${changed.length} cogs.halte_price rows.`);
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
