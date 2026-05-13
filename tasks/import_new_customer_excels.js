const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { Pool } = require("pg");
const XLSX = require("xlsx");

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_URL;
if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL or SUPABASE_URL");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const FILES = [
  { file: "B2B JH SALES FILE.xlsx", baseChannel: "B2B JH Sales" },
  { file: "Halte Website 2026 New.xlsx", baseChannel: "Halte Website 2026" },
];

const SKIP_SHEETS = new Set([
  "SKU",
  "SKU2",
  "State",
  "City",
  "Coupon",
  "cx count",
  "Service_Notification",
  "RECEIVED FEEDBACK LIST",
  "Cx Feedbacks",
  "Sheet14",
]);

const FIELD_ALIASES = {
  orderId: ["ORDER ID NO.", "ORDER NO.", "Order No.", "ORDER ID", "BILL NO."],
  orderDate: ["ORDER DATE", "Order Date", "BILL DATE", "Date"],
  sku: ["SKU"],
  product: ["PRODUCT ", "Product Name", "ITEM NAME", "Requirement", "PRODUCT"],
  quantity: ["QUANTITY", "SALE QUANTITY", "Unit Sold"],
  amount: ["TOTAL AMOUNT", "Total Value", "NET AMOUNT", "Amount", "SUM of TOTAL AMOUNT"],
  name: ["CLIENT NAME", "PARTY NAME", "Customer Name", "Name ", "Cx Name", "Customer First Name"],
  lastName: ["Customer Last Name"],
  phone: ["CONTACT NO.", "Customer Mobile", "MOBILE NO.", "Mobile", "Mobile Number"],
  email: ["Email ID", "Customer Email", "Email", "EMAIL", "eMAIL"],
  address: ["Customer Address", "Address"],
  city: ["Customer City", "CITY NAME", "City"],
  state: ["Customer State", "STATE", "STATE NAME", "GST STATE NAME", "state"],
  pincode: ["Customer Pin Code", "PIN CODE", "Pincode", "Customer Pin Code"],
  gst: ["GST", "GST NO.", "Customer GST No."],
  status: ["STATUS", "Delivery Status"],
  brand: ["BRAND", "Brand Name", "brand"],
};

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function headerScore(row) {
  const normalized = row.map(normalizeHeader).filter(Boolean);
  let score = 0;
  for (const aliases of Object.values(FIELD_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(normalizeHeader(alias)))) score += 1;
  }
  return score;
}

function findHeaderRow(rows) {
  let bestIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 12); i += 1) {
    const score = headerScore(rows[i] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore >= 2 ? bestIndex : -1;
}

function getValue(row, headerIndexes, aliases) {
  for (const alias of aliases) {
    const indexes = headerIndexes.get(normalizeHeader(alias)) || [];
    for (const index of indexes) {
      const value = row[index];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
  }
  return "";
}

function parseAmount(value) {
  const cleaned = String(value || "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseQuantity(value) {
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10000 ? Math.round(parsed) : 1;
}

function parsePhone(value) {
  const raw = String(value || "");
  const match = raw.match(/\d[\d\s/+()-]{7,}\d/);
  if (!match) return "";
  const digits = match[0].replace(/\D/g, "");
  if (digits.length < 8) return "";
  const normalized = digits.length > 10 ? digits.slice(-10) : digits;
  return normalized.length === 10 ? `91${normalized}` : normalized;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000 && parsed.getFullYear() <= 2030) {
    return parsed;
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s+\d{1,2}:\d{2})?$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || year < 2000 || year > 2030) return null;
  return date;
}

function cleanName(name, lastName, email) {
  const joined = [name, lastName]
    .map((part) => String(part || "").trim())
    .filter((part) => part && !/^[-\s]+$/.test(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (joined) return joined;
  if (email) return email.split("@")[0].replace(/[._-]+/g, " ");
  return "";
}

function cleanText(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function customerIdFor(channel, key) {
  const hash = crypto.createHash("sha1").update(`${channel}|${key}`).digest("hex").slice(0, 12).toUpperCase();
  return `CX-${hash}`;
}

function orderIdFor(channel, sheetName, rowNumber, rawOrderId, billNo) {
  const base = rawOrderId || billNo;
  if (base) return String(base).trim();
  const hash = crypto.createHash("sha1").update(`${channel}|${sheetName}|${rowNumber}`).digest("hex").slice(0, 10).toUpperCase();
  return `${channel.replace(/[^A-Z0-9]+/gi, "-").toUpperCase()}-${hash}`;
}

function shouldImportSheet(sheetName) {
  if (SKIP_SHEETS.has(sheetName)) return false;
  return true;
}

function parseWorkbook(fileConfig) {
  const workbook = XLSX.readFile(fileConfig.file, { cellDates: true });
  const customers = new Map();
  const orders = [];
  const sheetStats = [];

  for (const sheetName of workbook.SheetNames) {
    if (!shouldImportSheet(sheetName)) continue;

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
    });
    const headerRowIndex = findHeaderRow(rows);
    if (headerRowIndex < 0) continue;

    const headers = rows[headerRowIndex] || [];
    const headerIndexes = new Map();
    headers.forEach((header, index) => {
      const key = normalizeHeader(header);
      if (!key) return;
      if (!headerIndexes.has(key)) headerIndexes.set(key, []);
      headerIndexes.get(key).push(index);
    });

    const channel = `${fileConfig.baseChannel} - ${sheetName}`;
    let parsedRows = 0;

    for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      if (!row.some((value) => value !== null && value !== undefined && String(value).trim() !== "")) continue;

      const email = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.email));
      const phone = parsePhone(getValue(row, headerIndexes, FIELD_ALIASES.phone));
      const name = cleanName(
        getValue(row, headerIndexes, FIELD_ALIASES.name),
        getValue(row, headerIndexes, FIELD_ALIASES.lastName),
        email,
      );
      if (!name && !phone && !email) continue;

      const city = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.city));
      const state = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.state));
      const pincode = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.pincode));
      const address = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.address));
      const gst = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.gst));
      const brand = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.brand));
      const product = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.product));
      const sku = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.sku));
      const amount = parseAmount(getValue(row, headerIndexes, FIELD_ALIASES.amount));
      const quantity = parseQuantity(getValue(row, headerIndexes, FIELD_ALIASES.quantity));
      const orderDate = parseDate(getValue(row, headerIndexes, FIELD_ALIASES.orderDate));
      const status = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.status)) || "DELIVERED";
      const rawOrderId = cleanText(getValue(row, headerIndexes, FIELD_ALIASES.orderId));

      const customerKey = phone || email?.toLowerCase() || `${name.toLowerCase()}|${pincode || ""}|${state || ""}`;
      const mapKey = `${channel}|${customerKey}`;
      const existing = customers.get(mapKey) || {
        customer_id: customerIdFor(channel, customerKey),
        name: name || phone || email,
        phone: phone || null,
        email,
        address,
        city,
        state,
        pincode,
        channel,
        total_orders: 0,
        total_spent: 0,
        last_order_date: null,
        notes: "",
      };

      existing.name = existing.name || name || phone || email;
      existing.phone = existing.phone || phone || null;
      existing.email = existing.email || email;
      existing.address = existing.address || address;
      existing.city = existing.city || city;
      existing.state = existing.state || state;
      existing.pincode = existing.pincode || pincode;
      if (amount > 0 || rawOrderId || sku || product) {
        existing.total_orders += 1;
        existing.total_spent += amount;
      }
      if (orderDate && (!existing.last_order_date || orderDate > existing.last_order_date)) {
        existing.last_order_date = orderDate;
      }
      const noteParts = [gst && `GST: ${gst}`, brand && `Brand: ${brand}`, product && `Product: ${product}`].filter(Boolean);
      if (noteParts.length && !existing.notes.includes(noteParts[0])) {
        existing.notes = [existing.notes, noteParts.join("; ")].filter(Boolean).join(" | ").slice(0, 1000);
      }
      customers.set(mapKey, existing);

      if (amount > 0 || rawOrderId || sku) {
        orders.push({
          amazon_order_id: orderIdFor(channel, sheetName, i + 1, rawOrderId, null),
          sku: sku || `CUSTOMER-DATA-${customerIdFor(channel, customerKey).slice(-6)}`,
          purchase_date: orderDate,
          order_status: status,
          fulfillment_channel: channel,
          sales_channel: channel,
          quantity,
          item_price: amount,
          ship_city: city,
          ship_state: state,
          ship_postal_code: pincode,
        });
      }

      parsedRows += 1;
    }

    if (parsedRows > 0) {
      sheetStats.push({ file: fileConfig.file, sheet: sheetName, channel, rows: parsedRows });
    }
  }

  return { customers: [...customers.values()], orders, sheetStats };
}

async function ensureCustomerChannel() {
  await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS channel VARCHAR DEFAULT 'website' NOT NULL");
  await pool.query("CREATE INDEX IF NOT EXISTS ix_customers_channel ON customers (channel)");
}

async function importData() {
  await ensureCustomerChannel();

  const allCustomers = new Map();
  const allOrders = [];
  const allSheetStats = [];

  for (const fileConfig of FILES) {
    const parsed = parseWorkbook(fileConfig);
    parsed.customers.forEach((customer) => {
      const existing = allCustomers.get(customer.customer_id);
      if (!existing) {
        allCustomers.set(customer.customer_id, customer);
        return;
      }
      existing.total_orders += customer.total_orders;
      existing.total_spent += customer.total_spent;
      existing.last_order_date =
        customer.last_order_date && (!existing.last_order_date || customer.last_order_date > existing.last_order_date)
          ? customer.last_order_date
          : existing.last_order_date;
      existing.notes = [existing.notes, customer.notes].filter(Boolean).join(" | ").slice(0, 1000);
    });
    allOrders.push(...parsed.orders);
    allSheetStats.push(...parsed.sheetStats);
  }

  const client = await pool.connect();
  let insertedCustomers = 0;
  let upsertedCustomers = 0;
  let insertedOrders = 0;
  try {
    await client.query("BEGIN");

    const customerPayload = [...allCustomers.values()].map((customer) => ({
      customer_id: customer.customer_id,
      name: customer.name || "Unknown Customer",
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      total_orders: customer.total_orders,
      total_spent: Math.round(customer.total_spent * 100) / 100,
      last_order_date: customer.last_order_date ? customer.last_order_date.toISOString() : null,
      notes: customer.notes || null,
      channel: customer.channel,
    }));

    if (customerPayload.length) {
      const result = await client.query(
        `
          WITH data AS (
            SELECT *
            FROM jsonb_to_recordset($1::jsonb) AS x(
              customer_id text,
              name text,
              phone text,
              email text,
              address text,
              city text,
              state text,
              pincode text,
              total_orders integer,
              total_spent numeric,
              last_order_date timestamptz,
              notes text,
              channel text
            )
          ),
          upserted AS (
            INSERT INTO customers (
              customer_id, name, phone, email, address, city, state, pincode,
              total_orders, total_spent, last_order_date, notes, channel
            )
            SELECT
              customer_id, name, phone, email, address, city, state, pincode,
              total_orders, total_spent, last_order_date, notes, channel
            FROM data
            ON CONFLICT (customer_id) DO UPDATE SET
              name = EXCLUDED.name,
              phone = COALESCE(customers.phone, EXCLUDED.phone),
              email = COALESCE(customers.email, EXCLUDED.email),
              address = COALESCE(customers.address, EXCLUDED.address),
              city = COALESCE(customers.city, EXCLUDED.city),
              state = COALESCE(customers.state, EXCLUDED.state),
              pincode = COALESCE(customers.pincode, EXCLUDED.pincode),
              total_orders = EXCLUDED.total_orders,
              total_spent = EXCLUDED.total_spent,
              last_order_date = COALESCE(EXCLUDED.last_order_date, customers.last_order_date),
              notes = COALESCE(NULLIF(EXCLUDED.notes, ''), customers.notes),
              channel = EXCLUDED.channel,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
          )
          SELECT
            COUNT(*) FILTER (WHERE inserted)::int AS inserted,
            COUNT(*) FILTER (WHERE NOT inserted)::int AS updated
          FROM upserted
        `,
        [JSON.stringify(customerPayload)],
      );
      insertedCustomers = Number(result.rows[0]?.inserted || 0);
      upsertedCustomers = Number(result.rows[0]?.updated || 0);
    }

    const orderPayload = allOrders.map((order) => ({
      amazon_order_id: order.amazon_order_id,
      purchase_date: order.purchase_date ? order.purchase_date.toISOString() : null,
      order_status: order.order_status,
      fulfillment_channel: order.fulfillment_channel,
      sales_channel: order.sales_channel,
      sku: order.sku,
      quantity: order.quantity,
      item_price: Math.round(order.item_price * 100) / 100,
      ship_city: order.ship_city,
      ship_state: order.ship_state,
      ship_postal_code: order.ship_postal_code,
    }));

    if (orderPayload.length) {
      const result = await client.query(
        `
          WITH data AS (
            SELECT *
            FROM jsonb_to_recordset($1::jsonb) AS x(
              amazon_order_id text,
              purchase_date timestamptz,
              order_status text,
              fulfillment_channel text,
              sales_channel text,
              sku text,
              quantity integer,
              item_price numeric,
              ship_city text,
              ship_state text,
              ship_postal_code text
            )
          )
          INSERT INTO orders (
            amazon_order_id, purchase_date, order_status, fulfillment_channel, sales_channel,
            sku, quantity, item_price, ship_city, ship_state, ship_postal_code
          )
          SELECT
            amazon_order_id, purchase_date, order_status, fulfillment_channel, sales_channel,
            sku, quantity, item_price, ship_city, ship_state, ship_postal_code
          FROM data
          ON CONFLICT (amazon_order_id, sku) DO NOTHING
        `,
        [JSON.stringify(orderPayload)],
      );
      insertedOrders = result.rowCount || 0;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log("Imported customer Excel data");
  console.table(allSheetStats);
  console.log({
    parsedCustomers: allCustomers.size,
    parsedOrders: allOrders.length,
    insertedCustomers,
    upsertedCustomers,
    insertedOrders,
  });
}

importData()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
