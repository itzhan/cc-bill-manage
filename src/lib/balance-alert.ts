import { prisma } from "./db";
import { sendBalanceAlertEmail } from "./mailer";

function parseNumberArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * 扫描所有开启了余额提醒的渠道, 按 intervalMin 节流, 按"已触发集合 fired"
 * 去重: 跌破某阈值 → 加入 fired + 发邮件; 余额回到 ≥ 阈值 → 从 fired 移除
 * (相当于"用户充钱了"), 下次再跌破时会重新提醒。
 *
 * 安全保证: 单个渠道处理出错不影响其他渠道; 邮件发送失败则不更新 fired
 * 也不更新 lastCheckAt, 下次会重试。
 */
export async function checkBalanceAlerts(): Promise<void> {
  const now = Date.now();
  let accounts: Array<{
    id: number;
    name: string;
    balance: number | null;
    balanceAlertIntervalMin: number;
    balanceAlertThresholdsJson: string | null;
    balanceAlertFiredJson: string | null;
    balanceAlertLastCheckAt: Date | null;
  }>;
  try {
    accounts = await prisma.upstreamAccount.findMany({
      where: { balanceAlertEnabled: true },
      select: {
        id: true,
        name: true,
        balance: true,
        balanceAlertIntervalMin: true,
        balanceAlertThresholdsJson: true,
        balanceAlertFiredJson: true,
        balanceAlertLastCheckAt: true,
      },
    });
  } catch (e) {
    console.error("[balance-alert] list failed:", e);
    return;
  }
  for (const a of accounts) {
    try {
      if (a.balanceAlertLastCheckAt) {
        const elapsedMin =
          (now - a.balanceAlertLastCheckAt.getTime()) / 60_000;
        if (elapsedMin < (a.balanceAlertIntervalMin ?? 60)) continue;
      }
      if (a.balance == null) continue;
      const thresholds = parseNumberArray(
        a.balanceAlertThresholdsJson,
      ).sort((x, y) => y - x);
      if (thresholds.length === 0) continue;

      const fired = new Set(parseNumberArray(a.balanceAlertFiredJson));
      const newCrossed: number[] = [];
      for (const T of thresholds) {
        if (a.balance >= T) {
          // 余额回到阈值之上 → 视为充值, 复位
          fired.delete(T);
        } else if (!fired.has(T)) {
          newCrossed.push(T);
          fired.add(T);
        }
      }

      if (newCrossed.length > 0) {
        try {
          await sendBalanceAlertEmail({
            accountName: a.name,
            crossed: newCrossed,
            balance: a.balance,
          });
        } catch (e) {
          console.error(
            `[balance-alert] send failed for ${a.name}:`,
            e instanceof Error ? e.message : e,
          );
          // 不更新 fired/lastCheckAt, 下个 tick 再试。
          continue;
        }
      }

      await prisma.upstreamAccount.update({
        where: { id: a.id },
        data: {
          balanceAlertLastCheckAt: new Date(now),
          balanceAlertFiredJson: JSON.stringify(
            Array.from(fired).sort((x, y) => y - x),
          ),
        },
      });
    } catch (e) {
      console.error(`[balance-alert] err for ${a.name}:`, e);
    }
  }
}
