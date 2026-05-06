"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type IconName =
  | "sales"
  | "profitability"
  | "customers"
  | "insights"
  | "inventory"
  | "replenishment"
  | "cogs"
  | "estimate"
  | "shipment"
  | "billAudit"
  | "specs"
  | "reports"
  | "sync"
  | "inventoryStatus"
  | "ordersStatus"
  | "logout";

const navItems: { href: string; label: string; icon: IconName }[] = [
  { href: "/sales", label: "Sales", icon: "sales" },
  { href: "/profitability", label: "Profitability", icon: "profitability" },
  { href: "/customers", label: "Customers", icon: "customers" },
  { href: "/customer-insights", label: "Customer Insights", icon: "insights" },
  { href: "/inventory", label: "Inventory", icon: "inventory" },
  { href: "/replenishment", label: "Replenishment", icon: "replenishment" },
  { href: "/cogs", label: "COGS", icon: "cogs" },
  { href: "/cogs-estimate", label: "COGS Estimate", icon: "estimate" },
  { href: "/shipment", label: "Shipments", icon: "shipment" },
  { href: "/shipment-bill-audit", label: "Bill Audit", icon: "billAudit" },
  { href: "/product-specs", label: "Product Specs", icon: "specs" },
  { href: "/reports", label: "Reports", icon: "reports" },
];

function SidebarIcon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "sales":
      return (
        <svg {...common} className={className}>
          <path d="M4 19V10" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M22 19v-4" />
        </svg>
      );
    case "profitability":
      return (
        <svg {...common} className={className}>
          <path d="M4 16l4-4 4 3 6-7 2 2" />
          <path d="M20 8h-5" />
          <path d="M20 8v5" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common} className={className}>
          <path d="M16 19a4 4 0 0 0-8 0" />
          <circle cx="12" cy="9" r="3" />
          <path d="M20 19a3 3 0 0 0-2-2.82" />
          <path d="M18 6.5A3 3 0 0 1 18 12" />
        </svg>
      );
    case "insights":
      return (
        <svg {...common} className={className}>
          <path d="M4 9h16" />
          <path d="M4 15h16" />
          <path d="M8 3v18" />
          <path d="M16 5v14" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...common} className={className}>
          <path d="M3 8.5L12 4l9 4.5" />
          <path d="M3 8.5V16l9 4 9-4V8.5" />
          <path d="M12 12l9-3.5" />
          <path d="M12 12L3 8.5" />
          <path d="M12 12v8" />
        </svg>
      );
    case "replenishment":
      return (
        <svg {...common} className={className}>
          <path d="M3 17h11V8H3z" />
          <path d="M14 11h3l3 3v3h-6" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="17.5" cy="17.5" r="1.5" />
        </svg>
      );
    case "cogs":
      return (
        <svg {...common} className={className}>
          <circle cx="12" cy="12" r="8" />
          <path d="M9.5 9.5c.3-1 1.2-1.5 2.5-1.5 1.7 0 2.8.8 2.8 2 0 1.1-.7 1.6-2.3 2l-1 .3c-1 .3-1.5.7-1.7 1.7" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "estimate":
      return (
        <svg {...common} className={className}>
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M8 7.5h8" />
          <path d="M8 11.5h2" />
          <path d="M14 11.5h2" />
          <path d="M8 15.5h2" />
          <path d="M14 15.5h2" />
        </svg>
      );
    case "shipment":
      return (
        <svg {...common} className={className}>
          <path d="M3 16h10V7H3z" />
          <path d="M13 10h4l4 4v2h-8" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="17.5" cy="17.5" r="1.5" />
        </svg>
      );
    case "billAudit":
      return (
        <svg {...common} className={className}>
          <path d="M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2Z" />
          <path d="M9 8h6" />
          <path d="M9 12h4" />
          <path d="M9 16h3" />
          <path d="M15 15l1.5 1.5L20 13" />
        </svg>
      );
    case "specs":
      return (
        <svg {...common} className={className}>
          <path d="M5 4h14v16H5z" />
          <path d="M9 4v3" />
          <path d="M9 10v2" />
          <path d="M9 15v1" />
          <path d="M13 4v2" />
          <path d="M13 12v4" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common} className={className}>
          <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M14 3.5v4h4" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "sync":
      return (
        <svg {...common} className={className}>
          <path d="M20 12a8 8 0 0 0-14.5-4.5" />
          <path d="M4 4v4h4" />
          <path d="M4 12a8 8 0 0 0 14.5 4.5" />
          <path d="M20 20v-4h-4" />
        </svg>
      );
    case "inventoryStatus":
      return (
        <svg {...common} className={className}>
          <path d="M4 7h16" />
          <path d="M6 7V5h12v2" />
          <path d="M5 7v11h14V7" />
          <path d="M10 11h4" />
          <path d="M10 14h4" />
        </svg>
      );
    case "ordersStatus":
      return (
        <svg {...common} className={className}>
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-6" />
          <path d="M22 19v-9" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common} className={className}>
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          <path d="M14 16l4-4-4-4" />
          <path d="M18 12H9" />
        </svg>
      );
    default:
      return null;
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    last_orders_sync: string | null;
    last_inventory_sync: string | null;
  } | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("haltedb_token");
    const userName = localStorage.getItem("haltedb_user");
    if (!token) {
      router.push("/");
      return;
    }
    setUser(userName);
  }, [router]);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync");
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch {
      // Backend may not be running and the dashboard can still render.
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncToast(data.message || "Sync triggered!");
        setTimeout(fetchSyncStatus, 5000);
      } else {
        setSyncToast(data.error || "Sync failed");
      }
    } catch {
      setSyncToast("Failed to reach backend");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncToast(null), 5000);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("haltedb_token");
    localStorage.removeItem("haltedb_user");
    router.push("/");
  };

  const formatSyncTime = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!user) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">H</div>
          <h1>HalteDB</h1>
        </div>

        <div className="sidebar-scroll">
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${pathname === item.href ? "active" : ""}`}
              >
                <span className="sidebar-link-icon">
                  <SidebarIcon name={item.icon} className="sidebar-icon-svg" />
                </span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="sidebar-sync">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn btn-primary"
              style={{
                width: "100%",
                justifyContent: "center",
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              {syncing ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Syncing...
                </>
              ) : (
                <>
                  <SidebarIcon name="sync" className="sidebar-action-icon" />
                  Sync Now
                </>
              )}
            </button>
            {syncStatus && (
              <div style={{ padding: "0 8px", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <SidebarIcon name="inventoryStatus" className="sidebar-status-icon" />
                  <span>Inventory: {formatSyncTime(syncStatus.last_inventory_sync)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <SidebarIcon name="ordersStatus" className="sidebar-status-icon" />
                  <span>Orders: {formatSyncTime(syncStatus.last_orders_sync)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--gradient-1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {user.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{user}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Admin
                </div>
              </div>
            </div>
            <button onClick={handleLogout} className="sidebar-link" style={{ width: "100%" }}>
              <span className="sidebar-link-icon">
                <SidebarIcon name="logout" className="sidebar-icon-svg" />
              </span>
              Logout
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      {syncToast && (
        <div className="toast toast-success">{syncToast}</div>
      )}
    </div>
  );
}
