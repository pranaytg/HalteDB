/**
 * Seed customers table with sample data
 * =======================================
 * Creates the customers table if needed, then inserts sample Indian customers.
 * Also links customer data with order shipping info where possible.
 *
 * Run from frontend/: node scripts/seed-customers.js
 */

const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres.nwvekllfbvcnezhapupt:RamanSir1234%40@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

const SAMPLE_CUSTOMERS = [
  { name: "Rajesh Kumar", phone: "919876543210", email: "rajesh.kumar@gmail.com", address: "12, MG Road, Sector 15", city: "Chandigarh", state: "Chandigarh", pincode: "160015" },
  { name: "Priya Sharma", phone: "919812345678", email: "priya.sharma@yahoo.com", address: "45, Model Town", city: "Ludhiana", state: "Punjab", pincode: "141002" },
  { name: "Amit Patel", phone: "919898765432", email: "amit.patel@outlook.com", address: "78, CG Road, Navrangpura", city: "Ahmedabad", state: "Gujarat", pincode: "380009" },
  { name: "Sneha Reddy", phone: "919845671234", email: "sneha.reddy@gmail.com", address: "22, Banjara Hills", city: "Hyderabad", state: "Telangana", pincode: "500034" },
  { name: "Vikram Singh", phone: "919811223344", email: "vikram.singh@hotmail.com", address: "Plot 5, DLF Phase 2", city: "Gurugram", state: "Haryana", pincode: "122002" },
  { name: "Meera Nair", phone: "919847112233", email: "meera.nair@gmail.com", address: "14, MG Road, Ernakulam", city: "Kochi", state: "Kerala", pincode: "682016" },
  { name: "Arjun Mehta", phone: "919820123456", email: "arjun.mehta@gmail.com", address: "203, Andheri West", city: "Mumbai", state: "Maharashtra", pincode: "400058" },
  { name: "Kavita Joshi", phone: "919810987654", email: "kavita.joshi@yahoo.com", address: "Block C, Janakpuri", city: "New Delhi", state: "Delhi", pincode: "110058" },
  { name: "Suresh Iyer", phone: "919841234567", email: "suresh.iyer@gmail.com", address: "88, T Nagar", city: "Chennai", state: "Tamil Nadu", pincode: "600017" },
  { name: "Deepika Gupta", phone: "919871234567", email: "deepika.gupta@outlook.com", address: "56, Gomti Nagar", city: "Lucknow", state: "Uttar Pradesh", pincode: "226010" },
  { name: "Rahul Verma", phone: "919818765432", email: "rahul.verma@gmail.com", address: "102, Koramangala", city: "Bangalore", state: "Karnataka", pincode: "560034" },
  { name: "Anjali Mishra", phone: "919833456789", email: "anjali.mishra@gmail.com", address: "7, Civil Lines", city: "Jaipur", state: "Rajasthan", pincode: "302006" },
  { name: "Sanjay Rao", phone: "919886543210", email: "sanjay.rao@yahoo.com", address: "34, JP Nagar", city: "Bangalore", state: "Karnataka", pincode: "560078" },
  { name: "Pooja Agarwal", phone: "919890123456", email: "pooja.agarwal@gmail.com", address: "29, Salt Lake", city: "Kolkata", state: "West Bengal", pincode: "700091" },
  { name: "Manish Tiwari", phone: "919815678901", email: "manish.tiwari@hotmail.com", address: "61, Arera Colony", city: "Bhopal", state: "Madhya Pradesh", pincode: "462016" },
  { name: "Nisha Deshmukh", phone: "919823456789", email: "nisha.deshmukh@gmail.com", address: "18, FC Road", city: "Pune", state: "Maharashtra", pincode: "411004" },
  { name: "Karan Chopra", phone: "919816543210", email: "karan.chopra@outlook.com", address: "90, Sector 17", city: "Chandigarh", state: "Chandigarh", pincode: "160017" },
  { name: "Ritu Saxena", phone: "919891234567", email: "ritu.saxena@gmail.com", address: "43, Hazratganj", city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
  { name: "Arun Pillai", phone: "919847654321", email: "arun.pillai@yahoo.com", address: "67, Vyttila", city: "Kochi", state: "Kerala", pincode: "682019" },
  { name: "Swati Pandey", phone: "919835678901", email: "swati.pandey@gmail.com", address: "11, Boring Road", city: "Patna", state: "Bihar", pincode: "800001" },
  { name: "Rohit Malhotra", phone: "919878901234", email: "rohit.malhotra@gmail.com", address: "23, Sector 44", city: "Noida", state: "Uttar Pradesh", pincode: "201303" },
  { name: "Divya Krishnan", phone: "919844321098", email: "divya.krishnan@outlook.com", address: "55, Anna Nagar", city: "Chennai", state: "Tamil Nadu", pincode: "600040" },
  { name: "Gaurav Bhatt", phone: "919817654321", email: "gaurav.bhatt@gmail.com", address: "39, Rajpur Road", city: "Dehradun", state: "Uttarakhand", pincode: "248001" },
  { name: "Anita Das", phone: "919832109876", email: "anita.das@yahoo.com", address: "72, Park Street", city: "Kolkata", state: "West Bengal", pincode: "700016" },
  { name: "Vivek Chauhan", phone: "919819876543", email: "vivek.chauhan@gmail.com", address: "15, Mall Road", city: "Shimla", state: "Himachal Pradesh", pincode: "171001" },
  { name: "Megha Kulkarni", phone: "919823109876", email: "megha.kulkarni@gmail.com", address: "48, Prabhat Road", city: "Pune", state: "Maharashtra", pincode: "411004" },
  { name: "Nikhil Jain", phone: "919811567890", email: "nikhil.jain@hotmail.com", address: "82, Lajpat Nagar", city: "New Delhi", state: "Delhi", pincode: "110024" },
  { name: "Shweta Bose", phone: "919836789012", email: "shweta.bose@gmail.com", address: "25, Ballygunge", city: "Kolkata", state: "West Bengal", pincode: "700019" },
  { name: "Pankaj Dubey", phone: "919894567890", email: "pankaj.dubey@outlook.com", address: "37, Residency Road", city: "Indore", state: "Madhya Pradesh", pincode: "452001" },
  { name: "Lakshmi Menon", phone: "919848901234", email: "lakshmi.menon@gmail.com", address: "63, Pattom", city: "Thiruvananthapuram", state: "Kerala", pincode: "695004" },
];

async function main() {
  console.log("Creating customers table if not exists...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      customer_id VARCHAR UNIQUE NOT NULL,
      name VARCHAR NOT NULL,
      phone VARCHAR,
      email VARCHAR,
      address VARCHAR,
      city VARCHAR,
      state VARCHAR,
      pincode VARCHAR,
      total_orders INTEGER DEFAULT 0,
      total_spent FLOAT DEFAULT 0.0,
      last_order_date TIMESTAMPTZ,
      notes VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Create indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_pincode ON customers(pincode)`);

  console.log("Seeding customers...");
  let inserted = 0;

  for (let i = 0; i < SAMPLE_CUSTOMERS.length; i++) {
    const c = SAMPLE_CUSTOMERS[i];
    const customerId = `CUST-${String(i + 1).padStart(4, "0")}`;

    // Check for matching orders by pincode to get real order data
    const orderData = await pool.query(
      `SELECT COUNT(DISTINCT amazon_order_id) as order_count,
              COALESCE(SUM(item_price), 0) as total_spent,
              MAX(purchase_date) as last_order
       FROM orders
       WHERE ship_postal_code = $1 OR LOWER(ship_city) = LOWER($2)`,
      [c.pincode, c.city]
    );

    const od = orderData.rows[0];
    const totalOrders = Number(od.order_count) || Math.floor(Math.random() * 10) + 1;
    const totalSpent = Number(od.total_spent) || Math.floor(Math.random() * 15000) + 500;
    const lastOrder = od.last_order || null;

    await pool.query(
      `INSERT INTO customers (customer_id, name, phone, email, address, city, state, pincode, total_orders, total_spent, last_order_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (customer_id) DO UPDATE SET
         name=$2, phone=$3, email=$4, address=$5, city=$6, state=$7, pincode=$8,
         total_orders=$9, total_spent=$10, last_order_date=$11, updated_at=NOW()`,
      [customerId, c.name, c.phone, c.email, c.address, c.city, c.state, c.pincode, totalOrders, totalSpent, lastOrder]
    );
    inserted++;
  }

  console.log(`Seeded ${inserted} customers.`);
  await pool.end();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Error:", err);
  pool.end();
  process.exit(1);
});
