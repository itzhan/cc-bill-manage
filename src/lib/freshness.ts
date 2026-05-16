// "今日值"在 Asia/Shanghai 历法下是否还算"今天产生的"。
//
// 背景: UpstreamKey.todayActualCost / SiteBoundAccount.todayUserCost 是
// sync 累加器, sync 成功才写新值。sync 失败时这些字段保留上次成功的旧值
// (DB 里我们保留它做账目历史), 但 UI / 利润计算不能再把它当"今日"。
// 凡是直接展示"今日 ..."的 API/页面都必须先过这个守护, 否则就会把
// 昨天/前天的累计值伪装成今天的消费。
//
// 同步成功 → lastUpdatedAt = now (Shanghai 今天)              → fresh
// 同步失败几小时/几天 → lastUpdatedAt 是昨天/更早 (Shanghai)  → stale
//
// stale 时 freshTodayActualCost / freshTodayUserCost 都返回 0;
// 调用方拿原值做 audit/算账时直接读 k.todayActualCost 即可。

function shanghaiDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function isFreshForToday(
  lastUpdatedAt: Date | null | undefined,
): boolean {
  if (!lastUpdatedAt) return false;
  return shanghaiDateString(lastUpdatedAt) === shanghaiDateString();
}

export function freshTodayActualCost(k: {
  todayActualCost: number;
  lastUpdatedAt: Date | null;
}): number {
  return isFreshForToday(k.lastUpdatedAt) ? k.todayActualCost : 0;
}

export function freshTodayUserCost(a: {
  todayUserCost: number;
  lastUpdatedAt: Date | null;
}): number {
  return isFreshForToday(a.lastUpdatedAt) ? a.todayUserCost : 0;
}

export function freshTodayCostBase(a: {
  todayCost: number;
  lastUpdatedAt: Date | null;
}): number {
  return isFreshForToday(a.lastUpdatedAt) ? a.todayCost : 0;
}
