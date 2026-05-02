import { NextResponse } from "next/server";
import { setPassword, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { oldPassword, newPassword } = (await req
    .json()
    .catch(() => ({}))) as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword) {
    return NextResponse.json(
      { error: "oldPassword and newPassword required" },
      { status: 400 },
    );
  }
  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: "new password too short (min 6)" },
      { status: 400 },
    );
  }
  const ok = await verifyPassword(oldPassword);
  if (!ok) {
    return NextResponse.json({ error: "old password wrong" }, { status: 401 });
  }
  await setPassword(newPassword);
  return NextResponse.json({ ok: true });
}
