"""Delete orders with purchase_date in the future (bad source data, e.g. 2027, 2205)."""
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
if not DATABASE_URL:
    raise SystemExit("SUPABASE_URL not set")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)


async def main(apply: bool):
    now = datetime.now(timezone.utc)
    async with SessionLocal() as s:
        rows = (await s.execute(text(
            "SELECT EXTRACT(YEAR FROM purchase_date)::int AS yr, COUNT(*) "
            "FROM orders WHERE purchase_date > :now GROUP BY yr ORDER BY yr"
        ), {"now": now})).all()

        total = sum(r[1] for r in rows)
        print(f"Future-dated orders (purchase_date > {now.isoformat()}): {total}")
        for yr, c in rows:
            print(f"  year {yr}: {c}")

        if not apply:
            print("\nDry run. Re-run with --apply to delete.")
            return
        if total == 0:
            return

        res = await s.execute(text("DELETE FROM orders WHERE purchase_date > :now"), {"now": now})
        await s.commit()
        print(f"Deleted {res.rowcount} rows.")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
