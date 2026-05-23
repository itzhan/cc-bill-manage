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

async function postEmailSingle(
  cfg: MailConfig,
  recipient: string,
  subject: string,
  htmlContent: string,
  textContent: string,
): Promise<void> {
  const body: AifunSendPayload = {
    sendEmail: cfg.sendEmail,
    // aifun 接口对数组里的多个收件人只会发到第一个,所以一次只塞一个,
    // 外层循环 N 次,保证每个收件人都收到。
    receiveEmail: [recipient],
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

async function postEmail(
  cfg: MailConfig,
  subject: string,
  htmlContent: string,
  textContent: string,
): Promise<void> {
  if (cfg.receivers.length === 0) {
    throw new Error("no receivers");
  }
  // 并发对每个收件人发一次。allSettled 让部分失败不影响其他人; 只要
  // 至少有一个成功就当作整体成功(失败信息进 console 留存)。
  const results = await Promise.allSettled(
    cfg.receivers.map((r) =>
      postEmailSingle(cfg, r, subject, htmlContent, textContent),
    ),
  );
  const failures = results
    .map((r, i) => (r.status === "rejected" ? `${cfg.receivers[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}` : null))
    .filter((x): x is string => x != null);
  if (failures.length === cfg.receivers.length) {
    throw new Error(`all recipients failed: ${failures.join("; ").slice(0, 600)}`);
  }
  if (failures.length > 0) {
    console.error("[mailer] partial send failures:", failures);
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

/** Per-site snapshot row used by the error-rate check below. */
export interface SiteErrorSnapshot {
  siteId: number;
  siteName: string;
  errorRate: number;
  upstreamErrorRate: number;
  requestCountTotal: number;
  errorCountTotal: number;
  successCount: number;
  sla: number;
  generatedAt: string;
}

function buildErrorRateAlertHtml(
  threshold: number,
  rows: SiteErrorSnapshot[],
): string {
  const tbody = rows
    .map(
      (r) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.siteName)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:#dc2626;font-weight:600">${(r.errorRate * 100).toFixed(2)}%</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${(r.upstreamErrorRate * 100).toFixed(2)}%</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${r.errorCountTotal.toLocaleString()} / ${r.requestCountTotal.toLocaleString()}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${(r.sla * 100).toFixed(2)}%</td>
        </tr>
      `,
    )
    .join("");
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:760px">
  <h2 style="margin:0 0 8px;color:#dc2626">请求错误率超过阈值</h2>
  <p style="color:#6b7280;margin:0 0 16px">阈值 ${(threshold * 100).toFixed(2)}% · 时间窗口 1h（sub2api snapshot-v2）</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">站点</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">请求错误率</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">上游错误率</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">错误 / 总请求</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">SLA</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>
  <p style="margin-top:16px;color:#9ca3af;font-size:12px">由 Bill Manage 自动发出 · ${new Date().toLocaleString("zh-CN")}</p>
</div>
  `.trim();
}

function buildErrorRateAlertText(
  threshold: number,
  rows: SiteErrorSnapshot[],
): string {
  const lines: string[] = [
    `请求错误率告警（阈值 ${(threshold * 100).toFixed(2)}%）`,
    "",
  ];
  for (const r of rows) {
    lines.push(
      `${r.siteName}: 请求错误率 ${(r.errorRate * 100).toFixed(2)}% · 上游错误率 ${(r.upstreamErrorRate * 100).toFixed(2)}% · ${r.errorCountTotal}/${r.requestCountTotal} · SLA ${(r.sla * 100).toFixed(2)}%`,
    );
  }
  return lines.join("\n");
}

/**
 * If any site's request error_rate exceeds the configured threshold within
 * the last hour, send one combined email listing all offenders. Cooldown
 * prevents repeated emails while the issue persists. Safe to call from
 * scheduled jobs — never throws.
 */
export async function maybeSendErrorRateAlert(
  rows: SiteErrorSnapshot[],
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!s) return { sent: false, reason: "no settings" };
    if (!s.errorRateAlertEnabled) return { sent: false, reason: "disabled" };
    const threshold = s.errorRateThreshold ?? 0.04;
    const offenders = rows.filter((r) => r.errorRate > threshold);
    if (offenders.length === 0) {
      return { sent: false, reason: "all under threshold" };
    }
    if (s.errorRateLastSentAt) {
      const elapsedMin =
        (Date.now() - s.errorRateLastSentAt.getTime()) / 60_000;
      if (elapsedMin < (s.errorRateCooldownMinutes ?? 30)) {
        return {
          sent: false,
          reason: `cooldown ${Math.round(elapsedMin)}/${s.errorRateCooldownMinutes}min`,
        };
      }
    }
    const cfg = await loadMailConfig();
    if (!cfg) return { sent: false, reason: "config incomplete" };

    // Pick the worst rate for the subject so the receiver sees severity at a glance.
    const worst = offenders.reduce(
      (m, r) => (r.errorRate > m ? r.errorRate : m),
      0,
    );
    const subject = `${cfg.subject}（请求错误率 ${(worst * 100).toFixed(2)}%）`;
    await postEmail(
      cfg,
      subject,
      buildErrorRateAlertHtml(threshold, offenders),
      buildErrorRateAlertText(threshold, offenders),
    );
    await prisma.settings.update({
      where: { id: 1 },
      data: { errorRateLastSentAt: new Date() },
    });
    return { sent: true };
  } catch (e) {
    console.error("[mailer] error-rate send failed:", e);
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── Group outage alert (资源调度 自动检测) ──
// 当某个分组的全部账号在自动/手动测试里都失败时,触发邮件。冷却窗口在
// 进程内按 `${siteId}:${groupId}` 记忆,避免长时间停服时短时重发。
// 复用 Settings.emailCooldownMinutes 作为冷却时长。
const groupAlertLastSent = new Map<string, number>();

export interface GroupOutagePayload {
  siteName: string;
  groupName: string;
  totalAccounts: number;
  failingAccounts: { name: string; error?: string }[];
}

function buildGroupOutageHtml(p: GroupOutagePayload): string {
  const rows = p.failingAccounts
    .map(
      (a) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(a.name)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626">${escapeHtml(a.error ?? "")}</td>
        </tr>
      `,
    )
    .join("");
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:760px">
  <h2 style="margin:0 0 8px;color:#dc2626">分组全部账号失效告警</h2>
  <p style="color:#6b7280;margin:0 0 16px">站点 <strong>${escapeHtml(p.siteName)}</strong> · 分组 <strong>${escapeHtml(p.groupName)}</strong> · 共 ${p.totalAccounts} 个账号全部测试失败</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">账号</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">错误</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="2" style="padding:12px;text-align:center;color:#9ca3af">无明细</td></tr>`}</tbody>
  </table>
  <p style="margin-top:16px;color:#9ca3af;font-size:12px">由 Bill Manage 自动发出 · ${new Date().toLocaleString("zh-CN")}</p>
</div>
  `.trim();
}

function buildGroupOutageText(p: GroupOutagePayload): string {
  const lines: string[] = [
    `分组全部账号失效`,
    `站点: ${p.siteName} · 分组: ${p.groupName} · ${p.totalAccounts} 个账号全部失败`,
    "",
  ];
  for (const a of p.failingAccounts) {
    lines.push(`- ${a.name}: ${a.error ?? ""}`);
  }
  return lines.join("\n");
}

export async function maybeSendGroupOutageAlert(opts: {
  siteId: number;
  groupId: number;
  siteName: string;
  groupName: string;
  totalAccounts: number;
  failingAccounts: { name: string; error?: string }[];
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!s) return { sent: false, reason: "no settings" };
    const cooldownMin = s.emailCooldownMinutes ?? 30;
    const key = `${opts.siteId}:${opts.groupId}`;
    const last = groupAlertLastSent.get(key);
    if (last != null) {
      const elapsedMin = (Date.now() - last) / 60_000;
      if (elapsedMin < cooldownMin) {
        return {
          sent: false,
          reason: `cooldown ${Math.round(elapsedMin)}/${cooldownMin}min`,
        };
      }
    }
    const cfg = await loadMailConfig();
    if (!cfg) return { sent: false, reason: "config incomplete" };
    const subject = `${cfg.subject}（分组「${opts.groupName}」全部账号失效）`;
    const payload: GroupOutagePayload = {
      siteName: opts.siteName,
      groupName: opts.groupName,
      totalAccounts: opts.totalAccounts,
      failingAccounts: opts.failingAccounts,
    };
    await postEmail(
      cfg,
      subject,
      buildGroupOutageHtml(payload),
      buildGroupOutageText(payload),
    );
    groupAlertLastSent.set(key, Date.now());
    return { sent: true };
  } catch (e) {
    console.error("[mailer] group outage send failed:", e);
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── 余额提醒 ──
// 一通跌破阈值就发一封, 不再做额外冷却(checkBalanceAlerts 的"已触发集合"
// 已经避免了重复)。每个渠道独立 firedSet, 互不影响。
function buildBalanceAlertHtml(p: {
  accountName: string;
  crossed: number[];
  balance: number;
}): string {
  const rows = p.crossed
    .map(
      (t) => `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee">$${fmt(t, 2)}</td>
      </tr>`,
    )
    .join("");
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:640px">
  <h2 style="margin:0 0 8px;color:#d97706">渠道余额跌破阈值</h2>
  <p style="color:#6b7280;margin:0 0 16px">
    <strong>${escapeHtml(p.accountName)}</strong> 当前余额 <strong style="color:#dc2626">$${fmt(p.balance, 2)}</strong>
  </p>
  <p style="color:#6b7280;margin:0 0 8px;font-size:13px">本次跌破的阈值：</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:16px;color:#9ca3af;font-size:12px">
    充值并回到阈值以上后，下次再跌破时会重新提醒。<br/>
    由 Bill Manage 自动发出 · ${new Date().toLocaleString("zh-CN")}
  </p>
</div>`.trim();
}

function buildBalanceAlertText(p: {
  accountName: string;
  crossed: number[];
  balance: number;
}): string {
  const lines = [
    `渠道「${p.accountName}」余额跌破阈值`,
    `当前余额: $${fmt(p.balance, 2)}`,
    `跌破阈值: ${p.crossed.map((t) => `$${fmt(t, 2)}`).join(", ")}`,
  ];
  return lines.join("\n");
}

export async function sendBalanceAlertEmail(opts: {
  accountName: string;
  crossed: number[];
  balance: number;
}): Promise<void> {
  const cfg = await loadMailConfig();
  if (!cfg) throw new Error("邮件配置不完整");
  const subject = `${cfg.subject}（${opts.accountName} 余额 $${fmt(opts.balance, 2)}）`;
  await postEmail(
    cfg,
    subject,
    buildBalanceAlertHtml(opts),
    buildBalanceAlertText(opts),
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
