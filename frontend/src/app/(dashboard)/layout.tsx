"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

const navItems = [
  { href: "/sales", label: "Sales", icon: "📊" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/inventory", label: "Inventory", icon: "📦" },
  { href: "/cogs", label: "COGS", icon: "💰" },
  { href: "/cogs-estimate", label: "COGS Estimate", icon: "🧮" },
  { href: "/shipment", label: "Shipments", icon: "🚚" },
  { href: "/product-specs", label: "Product Specs", icon: "📐" },
  { href: "/reports", label: "Reports", icon: "📥" },
];

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

  // Fetch sync status on load
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync");
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch {
      // Backend may not be running — that's fine
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
        // Refetch status after a delay
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

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${
                pathname === item.href ? "active" : ""
              }`}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Sync Section */}
        <div style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
          marginTop: "auto",
          marginBottom: 16,
        }}>
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
              "🔄 Sync Now"
            )}
          </button>
          {syncStatus && (
            <div style={{ padding: "0 8px", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
              <div>📦 Inventory: {formatSyncTime(syncStatus.last_inventory_sync)}</div>
              <div>📊 Orders: {formatSyncTime(syncStatus.last_orders_sync)}</div>
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
            <span className="sidebar-link-icon">🚪</span>
            Logout
          </button>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      {/* Sync Toast */}
      {syncToast && (
        <div className="toast toast-success">{syncToast}</div>
      )}
    </div>
  );
}
