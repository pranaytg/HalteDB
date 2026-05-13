"use client";

import { useEffect, useState } from "react";

type PageAccessRole = "admin" | "user";

const ADMIN_PASSWORD = "OnlyForRamanSir";
const USER_PASSWORD = "ForUsers";
const ADMIN_KEY = "haltedb:page-access:admin";
const USER_KEY = "haltedb:page-access:user";

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function hasStoredAccess(role: PageAccessRole) {
  if (!storageAvailable()) return false;
  if (window.localStorage.getItem(ADMIN_KEY) === "1") return true;
  return role === "user" && window.localStorage.getItem(USER_KEY) === "1";
}

export function usePageAccess(role: PageAccessRole) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkedAccess, setCheckedAccess] = useState(false);

  useEffect(() => {
    setIsAuthorized(hasStoredAccess(role));
    setCheckedAccess(true);
  }, [role]);

  const unlock = (password: string) => {
    if (unlockPageAccess(role, password)) {
      setIsAuthorized(true);
      return true;
    }

    return false;
  };

  return { checkedAccess, isAuthorized, unlock, authorize: () => setIsAuthorized(true) };
}

export function unlockPageAccess(role: PageAccessRole, password: string) {
  const trimmed = password.trim();
  if (trimmed === ADMIN_PASSWORD) {
    if (storageAvailable()) window.localStorage.setItem(ADMIN_KEY, "1");
    return true;
  }

  if (role === "user" && trimmed === USER_PASSWORD) {
    if (storageAvailable()) window.localStorage.setItem(USER_KEY, "1");
    return true;
  }

  return false;
}

export function PasswordGate({
  role,
  title = "Security Check",
  onUnlock,
  onInvalid,
}: {
  role: PageAccessRole;
  title?: string;
  onUnlock?: () => void;
  onInvalid?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div className="card" style={{ padding: 40, textAlign: "center", maxWidth: 400, width: "100%" }}>
        <h2 style={{ marginBottom: 20 }}>{title}</h2>
        <p style={{ marginBottom: 20, color: "var(--text-muted)" }}>This page requires a password.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (unlockPageAccess(role, password)) {
              setError("");
              onUnlock?.();
              return;
            }
            setError("Incorrect password");
            onInvalid?.();
          }}
        >
          <input
            type="password"
            className="filter-input"
            style={{ width: "100%", marginBottom: 16 }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password..."
            autoFocus
          />
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Unlock Dashboard
          </button>
          {error && <div style={{ marginTop: 12, color: "var(--danger)" }}>{error}</div>}
        </form>
      </div>
    </div>
  );
}
