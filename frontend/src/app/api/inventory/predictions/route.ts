import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { generateForecasts } from "@/lib/forecasting";

export async function GET() {
  try {
    // Get monthly sales velocity per SKU
    const salesVelocityQuery = `
      SELECT 
        TO_CHAR(purchase_date, 'YYYY-MM') as month,
        sku,
        COALESCE(SUM(quantity), 0) as total_quantity,
        COALESCE(SUM(item_price), 0) as total_revenue
      FROM orders
      WHERE purchase_date IS NOT NULL
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM'), sku
      ORDER BY month ASC
    `;
    const salesResult = await pool.query(salesVelocityQuery);

    const historicalData = salesResult.rows.map((r: { month: string; sku: string; total_quantity: string; total_revenue: string }) => ({
      month: r.month,
      sku: r.sku,
      total_quantity: parseInt(r.total_quantity),
      total_revenue: parseFloat(r.total_revenue),
    }));

    // SKU-level sales forecasts
    const forecasts = generateForecasts(historicalData, 3); // 3 months ahead

    // Current inventory by SKU
    const inventoryQuery = `
      SELECT 
        sku,
        SUM(fulfillable_quantity) as current_stock
      FROM inventory
      GROUP BY sku
    `;
    const inventoryResult = await pool.query(inventoryQuery);
    const currentStock = new Map<string, number>();
    for (const row of inventoryResult.rows) {
      currentStock.set(row.sku, parseInt(row.current_stock));
    }

    // Current inventory by warehouse + SKU
    const warehouseInvQuery = `
      SELECT 
        fulfillment_center_id as warehouse,
        sku,
        fulfillable_quantity as current_stock
      FROM inventory
    `;
    const warehouseInvResult = await pool.query(warehouseInvQuery);

    // Calculate restock predictions per SKU
    const skuPredictions = new Map<string, {
      sku: string;
      current_stock: number;
      predicted_demand_3m: number;
      restock_needed: number;
      months_of_stock: number;
    }>();

    const skuForecasts = new Map<string, number>();
    for (const f of forecasts) {
      const existing = skuForecasts.get(f.sku) || 0;
      skuForecasts.set(f.sku, existing + f.predicted_quantity);
    }

    for (const [sku, demand3m] of skuForecasts) {
      const stock = currentStock.get(sku) || 0;
      const monthlyDemand = demand3m / 3;
      const monthsOfStock = monthlyDemand > 0 ? stock / monthlyDemand : 999;
      const restock = Math.max(0, demand3m - stock);

      skuPredictions.set(sku, {
        sku,
        current_stock: stock,
        predicted_demand_3m: demand3m,
        restock_needed: restock,
        months_of_stock: Math.round(monthsOfStock * 10) / 10,
      });
    }

    // Warehouse-wise predictions
    const warehouseStockMap = new Map<string, Map<string, number>>();
    for (const row of warehouseInvResult.rows) {
      if (!warehouseStockMap.has(row.warehouse)) {
        warehouseStockMap.set(row.warehouse, new Map());
      }
      warehouseStockMap.get(row.warehouse)!.set(row.sku, parseInt(row.current_stock));
    }

    const warehousePredictions: {
      warehouse: string;
      total_stock: number;
      total_predicted_demand: number;
      total_restock_needed: number;
    }[] = [];

    for (const [warehouse, skuStockMap] of warehouseStockMap) {
      let totalStock = 0;
      let totalDemand = 0;
      let totalRestock = 0;

      for (const [sku, stock] of skuStockMap) {
        totalStock += stock;
        const demand = skuForecasts.get(sku) || 0;
        // Proportional demand based on warehouse stock ratio
        const totalSkuStock = currentStock.get(sku) || 1;
        const proportion = totalSkuStock > 0 ? stock / totalSkuStock : 0;
        const warehouseDemand = Math.round(demand * proportion);
        totalDemand += warehouseDemand;
        totalRestock += Math.max(0, warehouseDemand - stock);
      }

      warehousePredictions.push({
        warehouse,
        total_stock: totalStock,
        total_predicted_demand: totalDemand,
        total_restock_needed: totalRestock,
      });
    }

    return NextResponse.json({
      skuPredictions: [...skuPredictions.values()]
        .sort((a, b) => b.restock_needed - a.restock_needed),
      warehousePredictions: warehousePredictions
        .sort((a, b) => b.total_restock_needed - a.total_restock_needed),
      forecastHorizon: "3 months",
    });
  } catch (error) {
    console.error("Inventory predictions error:", error);
    return NextResponse.json(
      { error: "Failed to generate inventory predictions" },
      { status: 500 }
    );
  }
}
