"use client";

import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";

/* eslint-disable @typescript-eslint/no-explicit-any */

const INDIA_TOPO = "https://cdn.jsdelivr.net/npm/india-topojson@1.0.0/india.json";

interface MapMarker {
  name: string;
  revenue: number;
  coords: [number, number];
}

interface IndiaMapChartProps {
  selectedState: string;
  onStateClick: (state: string) => void;
  mapMarkers: MapMarker[];
  maxMapRevenue: number;
  getStateFill: (geoName: string) => string;
  fmtK: (v: number) => string;
}

export default function IndiaMapChart({
  selectedState,
  onStateClick,
  mapMarkers,
  maxMapRevenue,
  getStateFill,
  fmtK,
}: IndiaMapChartProps) {
  return (
    <ComposableMap
      projection="geoMercator"
      projectionConfig={{ scale: 1000, center: [82, 22] }}
      style={{ width: "100%", height: "auto" }}
    >
      <Geographies geography={INDIA_TOPO}>
        {({ geographies }: any) =>
          geographies.map((g: any) => {
            const geoName = g.properties?.name || g.properties?.NAME_1 || g.properties?.ST_NM || "";
            const isSelected = selectedState && geoName.toLowerCase() === selectedState.toLowerCase();
            return (
              <Geography
                key={g.rsmKey}
                geography={g}
                onClick={() => onStateClick(geoName)}
                style={{
                  default: {
                    fill: isSelected ? "#6366f1" : getStateFill(geoName),
                    stroke: isSelected ? "#a5b4fc" : "#475569",
                    strokeWidth: isSelected ? 1.5 : 0.5,
                    outline: "none",
                    cursor: "pointer",
                  },
                  hover: {
                    fill: isSelected ? "#818cf8" : "rgba(99, 102, 241, 0.5)",
                    stroke: "#a5b4fc",
                    strokeWidth: 1.2,
                    outline: "none",
                    cursor: "pointer",
                  },
                  pressed: { fill: "#6366f1", outline: "none" },
                }}
              />
            );
          })
        }
      </Geographies>
      {mapMarkers.map((m: MapMarker) => (
        <Marker key={m.name} coordinates={m.coords}>
          <circle
            r={Math.max(4, Math.sqrt(m.revenue / maxMapRevenue) * 25)}
            fill="rgba(255,255,255,0.15)"
            stroke="#a5b4fc"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => onStateClick(m.name)}
          />
          <text
            textAnchor="middle"
            y={3}
            style={{ fontSize: 7, fill: "#e2e8f0", fontWeight: 700, pointerEvents: "none" }}
          >
            {fmtK(m.revenue)}
          </text>
          {m.revenue / maxMapRevenue > 0.08 && (
            <text
              textAnchor="middle"
              y={-Math.max(6, Math.sqrt(m.revenue / maxMapRevenue) * 25) - 4}
              style={{ fontSize: 9, fill: "#cbd5e1", fontWeight: 600, pointerEvents: "none" }}
            >
              {m.name}
            </text>
          )}
        </Marker>
      ))}
    </ComposableMap>
  );
}
