"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/sales", label: "Sales", icon: "📊" },
  { href: "/inventory", label: "Inventory", icon: "📦" },
  { href: "/cogs", label: "COGS", icon: "💰" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("haltedb_token");
    const userName = localStorage.getItem("haltedb_user");
    if (!token) {
      router.push("/");
      return;
    }
    setUser(userName);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("haltedb_token");
    localStorage.removeItem("haltedb_user");
    router.push("/");
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
    </div>
  );
}
