import { Pool } from "pg";

// Direct connection to Supabase PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    "postgresql://postgres.nwvekllfbvcnezhapupt:RamanSir1234%40@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export default pool;
