/**
 * SQL expression that strips common variant suffixes from a SKU column,
 * collapsing things like "LG0973-P", "LG0973 2", "LG0973-1", "LG0973x2",
 * "LG0973.5x" all to their base "LG0973".
 *
 * Pass a fully-qualified column reference (e.g. "orders.sku" or "o.sku").
 */
export function normalizedSkuExpr(col: string): string {
  return `UPPER(TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(${col}, E'\\\\s+[A-Za-z]$', ''),
            E'\\\\s+\\\\d+$', ''
          ),
          E'-[A-Za-z]$', ''
        ),
        E'-\\\\d+$', ''
      ),
      E'x\\\\d+$', ''
    ),
    E'\\\\.\\\\d+x?$', ''
  )))`;
}

/**
 * LATERAL join clause that resolves an order row to its estimated_cogs entry,
 * preferring an exact SKU match and falling back to the normalized base SKU only
 * when no exact match exists. This avoids false-negatives for real SKUs that
 * happen to look like variants (e.g. "18980-28" is a real SKU, not a variant of "18980").
 *
 *   ordersAlias: the alias used for the orders table in the outer query
 *                (e.g. "o" or "orders")
 *   ecAlias:     alias to expose the joined estimated_cogs row as (default "ec")
 */
export function estimatedCogsLateralJoin(ordersAlias: string, ecAlias = "ec"): string {
  const norm = normalizedSkuExpr(`${ordersAlias}.sku`);
  return `LEFT JOIN LATERAL (
    SELECT ec_inner.*
    FROM estimated_cogs ec_inner
    WHERE LOWER(ec_inner.sku) = LOWER(${ordersAlias}.sku)
       OR LOWER(ec_inner.sku) = LOWER(${norm})
    ORDER BY CASE WHEN LOWER(ec_inner.sku) = LOWER(${ordersAlias}.sku) THEN 0 ELSE 1 END
    LIMIT 1
  ) ${ecAlias} ON TRUE`;
}
