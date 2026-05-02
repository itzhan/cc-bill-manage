import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSettings } from "@/lib/auth";
import { restartScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";

export async function GET() {
  const s = await ensureSettings();
  const { adminPasswordHash: _hash, ...rest } = s;
  void _hash;
  return NextResponse.json({ settings: rest });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    diffThreshold: number;
    syncIntervalMinutes: number;
    emailAlertEnabled: boolean;
    emailEndpoint: string;
    emailAuthToken: string | null;
    emailSenderEmail: string | null;
    emailSenderName: string | null;
    emailSenderAccountId: number | null;
    emailReceivers: string | null;
    emailSubject: string;
    emailCooldownMinutes: number;
    defaultAzSiteAccountId: number | null;
  }>;
  const data: Record<string, unknown> = {};
  if (body.diffThreshold != null) data.diffThreshold = body.diffThreshold;
  if (body.syncIntervalMinutes != null)
    data.syncIntervalMinutes = Math.max(1, Math.floor(body.syncIntervalMinutes));
  if (body.emailAlertEnabled != null)
    data.emailAlertEnabled = body.emailAlertEnabled;
  if (body.emailEndpoint != null) data.emailEndpoint = body.emailEndpoint;
  if (body.emailAuthToken !== undefined)
    data.emailAuthToken = body.emailAuthToken;
  if (body.emailSenderEmail !== undefined)
    data.emailSenderEmail = body.emailSenderEmail;
  if (body.emailSenderName !== undefined)
    data.emailSenderName = body.emailSenderName;
  if (body.emailSenderAccountId !== undefined)
    data.emailSenderAccountId = body.emailSenderAccountId;
  if (body.emailReceivers !== undefined)
    data.emailReceivers = body.emailReceivers;
  if (body.emailSubject != null) data.emailSubject = body.emailSubject;
  if (body.emailCooldownMinutes != null)
    data.emailCooldownMinutes = Math.max(0, Math.floor(body.emailCooldownMinutes));
  if ("defaultAzSiteAccountId" in body)
    data.defaultAzSiteAccountId = body.defaultAzSiteAccountId;
  await ensureSettings();
  const updated = await prisma.settings.update({ where: { id: 1 }, data });
  if (data.syncIntervalMinutes != null) {
    await restartScheduler();
  }
  const { adminPasswordHash: _hash, ...rest } = updated;
  void _hash;
  return NextResponse.json({ settings: rest });
}
