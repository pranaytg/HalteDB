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
