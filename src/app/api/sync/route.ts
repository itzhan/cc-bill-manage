import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const r = await syncAll();
  return NextResponse.json(r);
}
