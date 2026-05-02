import { NextResponse } from "next/server";
import { issueToken, setSessionCookie, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  if (!password) {
    return NextResponse.json({ error: "password required" }, { status: 400 });
  }
  const ok = await verifyPassword(password);
  if (!ok) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }
  const token = await issueToken();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
