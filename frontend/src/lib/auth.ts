import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode("haltedb-super-secret-key-2026");

// Hardcoded admin credentials
const ADMIN_ID = "RamanSir";
const ADMIN_PASSWORD = "RamanSir1234@";

export async function verifyCredentials(
  userId: string,
  password: string
): Promise<boolean> {
  return userId === ADMIN_ID && password === ADMIN_PASSWORD;
}

export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ userId, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

export async function verifyToken(
  token: string
): Promise<{ userId: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; role: string };
  } catch {
    return null;
  }
}
