import { Pool } from "pg";

// Direct connection to Supabase PostgreSQL — no SP-API here
const pool = new Pool({
  connectionString:
    "postgresql://postgres.nwvekllfbvcnezhapupt:RamanSir1234%40@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export default pool;
