import { prisma } from "./db";
import type { DashboardSummary, BindingDiff } from "./dashboard";

interface AifunSendPayload {
  sendEmail: string;
  receiveEmail: string[];
  accountId: number;
  manyType: null;
  name: string;
  subject: string;
  content: string;
  sendType: string;
  text: string;
  emailId: number;
  attachments: never[];
  draftId: null;
}

function fmt(n: number, digits = 4): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export interface MailConfig {
  endpoint: string;
  authToken: string;
  sendEmail: string;
  senderName: string;
  accountId: number;
  receivers: string[];
  subject: string;
}

export function readReceivers(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export async function loadMailConfig(): Promise<MailConfig | null> {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) return null;
  if (
    !s.emailAuthToken ||
    !s.emailSenderEmail ||
    !s.emailSenderName ||
    !s.emailSenderAccountId ||
    !s.emailReceivers
  ) {
    return null;
  }
  const receivers = readReceivers(s.emailReceivers);
  if (receivers.length === 0) return null;
  return {
    endpoint: s.emailEndpoint,
    authToken: s.emailAuthToken,
    sendEmail: s.emailSenderEmail,
    senderName: s.emailSenderName,
    accountId: s.emailSenderAccountId,
    receivers,
    subject: s.emailSubject || "上游差异通知",
  };
}

async function postEmail(
  cfg: MailConfig,
  subject: string,
  htmlContent: string,
  textContent: string,
): Promise<void> {
  const body: AifunSendPayload = {
    sendEmail: cfg.sendEmail,
    receiveEmail: cfg.receivers,
    accountId: cfg.accountId,
    manyType: null,
    name: cfg.senderName,
    subject,
    content: htmlContent,
    sendType: "",
    text: textContent,
    emailId: 0,
    attachments: [],
    draftId: null,
  };
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: cfg.authToken,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`email http ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  // server returns code/message envelope; surface non-zero codes too
  let json: { code?: number; message?: string } = {};
  try {
    json = (await res.json()) as { code?: number; message?: string };
  } catch {
    // some endpoints return empty body on success
    return;
  }
  if (json.code != null && json.code !== 0 && json.code !== 200) {
    throw new Error(`email api code=${json.code} msg=${json.message ?? ""}`);
  }
}

function buildAlertHtml(summary: DashboardSummary): string {
  const rows = summary.bindings
    .map((b: BindingDiff) => {
      const diffColor = Math.abs(b.diff) > summary.diffThreshold ? "#dc2626" : "#16a34a";
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(b.siteAccounts.map((s) => s.name).join("，"))}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(b.upstreamKeyName)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(b.upstreamGroupName)} ×${b.upstreamEffectiveMultiplier}${b.upstreamHasExclusiveRate ? "（专属）" : ""}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(b.siteCostBase, 2)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(b.upstreamTodayCostBase, 2)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${diffColor};font-weight:600">${fmt(b.diff, 2)}</td>
        </tr>
      `;
    })
    .join("");

  const totalColor = summary.diffOverThreshold ? "#dc2626" : "#16a34a";
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:760px">
  <h2 style="margin:0 0 8px">上游与本站计费差异告警</h2>
  <p style="color:#6b7280;margin:0 0 16px">差异 ${fmt(summary.totalDiff, 2)} ${summary.diffOverThreshold ? `已超过阈值 ${summary.diffThreshold}` : ""}</p>

  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">本站账号</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">上游 Key</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">分组×倍率</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">本站 1×</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">上游 1×</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">差异</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="6" style="padding:12px;text-align:center;color:#9ca3af">无绑定明细</td></tr>`}</tbody>
  </table>

  <div style="margin-top:20px;padding:12px;background:#f9fafb;border-radius:6px">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#6b7280">本站 1× 总和</span>
      <strong>${fmt(summary.totalSiteCostBase, 2)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#6b7280">上游 1× 总和</span>
      <strong>${fmt(summary.totalUpstreamCostBase, 2)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#6b7280">总差异</span>
      <strong style="color:${totalColor}">${fmt(summary.totalDiff, 2)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#6b7280">阈值</span>
      <strong>${summary.diffThreshold}</strong>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0"/>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#6b7280">今日收入</span>
      <strong>${fmt(summary.totalRevenue, 2)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#6b7280">今日支出</span>
      <strong>${fmt(summary.totalExpense, 2)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#6b7280">今日利润</span>
      <strong>${fmt(summary.totalProfit, 2)}</strong>
    </div>
  </div>

  <p style="margin-top:16px;color:#9ca3af;font-size:12px">由 Bill Manage 自动发出 · ${new Date().toLocaleString("zh-CN")}</p>
</div>
  `.trim();
}

function buildAlertText(summary: DashboardSummary): string {
  const lines: string[] = [];
  lines.push(`上游差异告警`);
  lines.push(`总差异 ${fmt(summary.totalDiff, 2)} 阈值 ${summary.diffThreshold}`);
  lines.push("");
  for (const b of summary.bindings) {
    lines.push(
      `${b.siteAccounts.map((s) => s.name).join("，")} → ${b.upstreamKeyName} [${b.upstreamGroupName} ×${b.upstreamEffectiveMultiplier}] 本站1×=${fmt(b.siteCostBase, 2)} 上游1×=${fmt(b.upstreamTodayCostBase, 2)} 差异=${fmt(b.diff, 2)}`,
    );
  }
  lines.push("");
  lines.push(`本站1×总和: ${fmt(summary.totalSiteCostBase, 2)}`);
  lines.push(`上游1×总和: ${fmt(summary.totalUpstreamCostBase, 2)}`);
  lines.push(`今日收入: ${fmt(summary.totalRevenue, 2)}`);
  lines.push(`今日支出: ${fmt(summary.totalExpense, 2)}`);
  lines.push(`今日利润: ${fmt(summary.totalProfit, 2)}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Send a one-off test email so the user can verify config. */
export async function sendTestEmail(): Promise<void> {
  const cfg = await loadMailConfig();
  if (!cfg) throw new Error("邮件配置不完整，请先填写发件人和收件人");
  const html = `<div style="font-family:sans-serif"><h3>测试邮件</h3><p>来自 Bill Manage · ${new Date().toLocaleString("zh-CN")}</p></div>`;
  await postEmail(
    cfg,
    `${cfg.subject}（测试）`,
    html,
    `Bill Manage 测试邮件 ${new Date().toISOString()}`,
  );
}

/**
 * Check current diff against threshold and send an alert email if needed.
 * Respects per-Settings cooldown to avoid spamming during persistent
 * deviations. Safe to call from syncAll — never throws.
 */
export async function maybeSendDiffAlert(
  summary: DashboardSummary,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!s) return { sent: false, reason: "no settings" };
    if (!s.emailAlertEnabled) return { sent: false, reason: "disabled" };
    if (!summary.diffOverThreshold) return { sent: false, reason: "under threshold" };

    const cfg = await loadMailConfig();
    if (!cfg) return { sent: false, reason: "config incomplete" };

    // cooldown
    if (s.emailLastSentAt) {
      const elapsedMin =
        (Date.now() - s.emailLastSentAt.getTime()) / 60_000;
      if (elapsedMin < s.emailCooldownMinutes) {
        return {
          sent: false,
          reason: `cooldown ${Math.round(elapsedMin)}/${s.emailCooldownMinutes}min`,
        };
      }
    }

    const subject = `${cfg.subject} (差异 ${fmt(summary.totalDiff, 2)})`;
    await postEmail(cfg, subject, buildAlertHtml(summary), buildAlertText(summary));
    await prisma.settings.update({
      where: { id: 1 },
      data: { emailLastSentAt: new Date() },
    });
    return { sent: true };
  } catch (e) {
    console.error("[mailer] alert send failed:", e);
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
