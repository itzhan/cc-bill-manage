import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./db";

const COOKIE_NAME = "bm_session";
const ALG = "HS256";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export async function ensureSettings() {
  let s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) {
    const initial = process.env.INITIAL_ADMIN_PASSWORD || "ab123168";
    const hash = await bcrypt.hash(initial, 10);
    s = await prisma.settings.create({
      data: { id: 1, adminPasswordHash: hash },
    });
  }
  return s;
}

export async function verifyPassword(plain: string): Promise<boolean> {
  const s = await ensureSettings();
  return bcrypt.compare(plain, s.adminPasswordHash);
}

export async function setPassword(plain: string) {
  const hash = await bcrypt.hash(plain, 10);
  await prisma.settings.update({
    where: { id: 1 },
    data: { adminPasswordHash: hash },
  });
}

export async function issueToken(): Promise<string> {
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  const c = await cookies();
  const t = c.get(COOKIE_NAME)?.value;
  if (!t) return false;
  return verifyToken(t);
}

export const SESSION_COOKIE = COOKIE_NAME;
