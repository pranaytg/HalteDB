export function placedOrderConditions(orderAlias: string) {
  return [
    `LOWER(COALESCE(${orderAlias}.order_status, '')) NOT LIKE '%cancel%'`,
    `LOWER(COALESCE(${orderAlias}.item_status, '')) NOT LIKE '%cancel%'`,
  ];
}
