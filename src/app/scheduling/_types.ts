export interface SiteRow {
  id: number;
  name: string;
}

export interface GroupRow {
  id: number;
  name: string;
  rate_multiplier: number;
  status: string;
}

export interface AccountRow {
  id: number;
  name: string;
  status?: string;
  concurrency?: number;
  priority?: number;
  rate_multiplier?: number;
  group_ids?: number[];
  platform?: string;
  type?: string;
  error_message?: string | null;
  schedulable?: boolean;
  notes?: string | null;
}

export interface ConcurrencyState {
  account?: Record<
    string,
    {
      current_in_use: number;
      max_capacity?: number;
      group_id?: number;
      group_name?: string;
      waiting_in_queue?: number;
    }
  >;
}

export interface BindingInfo {
  bindingId: number;
  maxConcurrency: number | null;
  upstreamKeyName: string;
  upstreamAccountName: string;
  upstreamGroupName: string;
  upstreamGroupRateMultiplier: number;
  upstreamEffectiveRateMultiplier: number;
  upstreamHasExclusiveRate: boolean;
}

export interface GroupUsersRow {
  group_id: number;
  group_name: string;
  users: Array<{
    user_id: number;
    email?: string;
    requests: number;
    cost: number;
    actual_cost: number;
  }>;
}

export interface CustomGroupRow {
  id: number;
  siteAccountId: number;
  name: string;
  groupIds: number[];
}

export interface TemplateRow {
  id: number;
  name: string;
  siteAccountId: number | null;
  platform: string;
  type: string;
  rateMultiplier: number;
  groupIds: string;
  modelList: string;
  confirmMixedChannelRisk: boolean;
  notes: string | null;
}

export interface ErrorRankRecentEvent {
  id: number;
  createdAt: string;
  statusCode: number;
  model: string;
  requestedModel: string;
  message: string;
  groupId: number | null;
  groupName: string;
  userId: number | null;
  userEmail: string;
  requestId: string;
  requestPath: string;
  isRetryable: boolean;
}

export interface ErrorRankAccount {
  accountId: number;
  accountName: string;
  count: number;
  share: number;
  byStatus: Record<string, number>;
  byModel: Record<string, number>;
  groups: { groupId: number; groupName: string; count: number }[];
  latestAt: string;
  latestMessage: string;
  latestStatus: number;
  recentEvents: ErrorRankRecentEvent[];
}

export interface ErrorRankSummary {
  errorRate: number;
  upstreamErrorRate: number;
  sla: number;
  requestCountTotal: number;
  successCount: number;
  errorCountTotal: number;
  businessLimitedCount: number;
  errorCountSla: number;
  upstreamErrorCount429: number;
  upstreamErrorCount529: number;
  upstreamErrorCountOther: number;
  healthScore: number | null;
  generatedAt: string;
}

export interface ErrorRankPayload {
  range: string;
  totalErrors: number;
  processed: number;
  truncated: boolean;
  recentPerAccount: number;
  summary: ErrorRankSummary | null;
  accounts: ErrorRankAccount[];
}

export interface GroupedEntry {
  group: GroupRow;
  accounts: AccountRow[];
  unscheduled: AccountRow[];
  inFlight: number;
  capacity: number;
  active: number;
  inactive: number;
  todayCost: number;
}

export function isErrored(a: AccountRow): boolean {
  return (
    a.status === "error" ||
    (typeof a.error_message === "string" && a.error_message.trim().length > 0)
  );
}

export function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const ERROR_RANGES: { key: string; label: string }[] = [
  { key: "1h", label: "近 1 小时" },
  { key: "6h", label: "近 6 小时" },
  { key: "24h", label: "近 24 小时" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
];
