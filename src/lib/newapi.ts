// Adapter for new-api as an UPSTREAM. We are a regular USER on the new-api
// server (not admin). Authenticated via session cookie + New-Api-User header.
//
// Differences from sub2api covered transparently:
//   - quota integer (1 USD = 500_000 quota) → return as USD float
//   - no batch /api-keys-usage → fetch /api/log/self once, aggregate by token
//   - no group_id → use group string; rate_multiplier filled by caller from
//     getUserGroupRates() like sub2api does
//
// Surface (drop-in for upstream-side Sub2ApiClient):
//   - login()
//   - getMe()  → {id, email, username, balance, role}
//   - listKeys() → KeyItem[]
//   - getKeysUsage(ids)  → Record<id, KeyUsageItem>
//   - getUserGroupRates() → Record<string|number, number>

import type { KeyItem, KeyUsageItem } from "./sub2api";

export interface NewApiCredsState {
  baseUrl: string;
  // newapi calls this `username`; we store it under the existing `email`
  // column so the UpstreamAccount schema stays unchanged.
  email: string;
  password: string;
  // Session cookie string (e.g. "session=...; gin-session=...").
  // Persisted via the same accessToken column on UpstreamAccount.
  cookieJar?: string | null;
  userId?: number | null;
}

export interface NewApiPersistHook {
  // Called after a successful login. Caller persists cookieJar + userId to DB.
  onSession?: (
    cookieJar: string,
    userId: number,
    expiresInSec: number,
  ) => Promise<void>;
}

const QUOTA_PER_USD = 500_000;

interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

// Asia/Shanghai start-of-today in unix seconds.
function todayMidnightSec(): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = fmt.format(new Date()); // YYYY-MM-DD
  // Date string parsed at UTC; Shanghai is +08:00, so subtract 8h to get UTC ms.
  const ms = Date.parse(`${date}T00:00:00+08:00`);
  return Math.floor(ms / 1000);
}

interface NewApiTokenRow {
  id: number;
  user_id: number;
  name: string;
  key: string; // already masked
  group: string;
  status: number;
  used_quota: number;
  remain_quota: number;
  unlimited_quota?: boolean;
  expired_time?: number;
}

interface NewApiLogRow {
  // Field names vary across new-api forks; we read defensively.
  id?: number;
  user_id?: number;
  token_name?: string;
  tokenName?: string;
  quota?: number;
  created_at?: number;
  type?: number;
}

export class NewApiClient {
  private base: string;
  private tokensCache: NewApiTokenRow[] | null = null;

  constructor(
    private readonly creds: NewApiCredsState,
    private readonly hook: NewApiPersistHook = {},
  ) {
    this.base = trimSlash(creds.baseUrl);
  }

  async login(): Promise<{ userId: number }> {
    const res = await fetch(`${this.base}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.creds.email,
        password: this.creds.password,
      }),
    });
    if (!res.ok) {
      throw new Error(`newapi login http ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Envelope<{ id: number }>;
    if (!json.success) {
      throw new Error(`newapi login failed: ${json.message ?? "unknown"}`);
    }
    const userId = json.data?.id;
    if (!userId) throw new Error("newapi login: missing user id in response");

    // Capture session cookie. Node 18+ has getSetCookie(); fall back to raw.
    type HeadersExt = Headers & { getSetCookie?: () => string[] };
    const headers = res.headers as HeadersExt;
    const cookies = headers.getSetCookie?.() ?? [];
    if (cookies.length === 0) {
      // Some proxies merge into single header; try the legacy 'set-cookie'.
      const merged = res.headers.get("set-cookie");
      if (merged) cookies.push(merged);
    }
    const cookieJar = cookies
      .map((c) => c.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
    if (!cookieJar) throw new Error("newapi login: no Set-Cookie returned");

    this.creds.cookieJar = cookieJar;
    this.creds.userId = userId;
    // Conservative: assume cookies last 12 h (real values vary; we re-login on 401)
    const expiresInSec = 12 * 3600;
    if (this.hook.onSession) {
      await this.hook.onSession(cookieJar, userId, expiresInSec);
    }
    return { userId };
  }

  private async ensureSession() {
    if (!this.creds.cookieJar || !this.creds.userId) await this.login();
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    await this.ensureSession();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: this.creds.cookieJar ?? "",
      "New-Api-User": String(this.creds.userId ?? ""),
    };
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      if (retried) {
        throw new Error(
          `newapi auth still failing after relogin: ${res.status}`,
        );
      }
      this.creds.cookieJar = null;
      await this.login();
      return this.request<T>(method, path, body, true);
    }
    if (!res.ok) {
      throw new Error(
        `newapi http ${res.status} ${path}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as Envelope<T>;
    if (!json.success) {
      throw new Error(`${path} api error: ${json.message ?? ""}`);
    }
    return json.data;
  }

  async getMe(): Promise<{
    id: number;
    email: string;
    username: string;
    balance: number;
    role: string;
  }> {
    const data = await this.request<{
      id: number;
      username: string;
      email?: string;
      role: number;
      quota: number;
      used_quota: number;
      group?: string;
    }>("GET", `/api/user/self`);
    return {
      id: data.id,
      email: data.email ?? this.creds.email,
      username: data.username,
      // Remaining balance, in USD float.
      balance: Math.max(0, (data.quota ?? 0) - (data.used_quota ?? 0)) /
        QUOTA_PER_USD,
      role: data.role >= 10 ? "admin" : "user",
    };
  }

  async listKeys(): Promise<KeyItem[]> {
    // p starts at 0 in new-api; size up to a few hundred.
    const data = await this.request<
      | { items?: NewApiTokenRow[]; data?: NewApiTokenRow[]; records?: NewApiTokenRow[] }
      | NewApiTokenRow[]
    >("GET", `/api/token/?p=0&size=200`);
    const tokens: NewApiTokenRow[] = Array.isArray(data)
      ? data
      : (data.items ?? data.records ?? data.data ?? []);
    this.tokensCache = tokens;
    return tokens.map((t) => ({
      id: t.id,
      user_id: t.user_id,
      key: t.key,
      name: t.name,
      // newapi has no group_id concept; we leave 0 and put the name on
      // the group struct so refreshUpstreamAccount's rate lookup uses name.
      group_id: 0,
      group: {
        id: 0,
        name: t.group || "default",
        // Filled by refreshUpstreamAccount via getUserGroupRates output.
        // Default to 1 so behavior degrades gracefully if rates missing.
        rate_multiplier: 1,
      },
    }));
  }

  // Aggregate today's per-token spend in ONE call, plus pull lifetime from
  // the cached tokens list (token.used_quota → total_actual_cost USD).
  async getKeysUsage(ids: number[]): Promise<Record<string, KeyUsageItem>> {
    if (!ids.length) return {};
    if (!this.tokensCache) {
      // Caller normally invokes listKeys first, but guard anyway.
      await this.listKeys();
    }
    const tokens = this.tokensCache ?? [];
    const tokensById = new Map(tokens.map((t) => [t.id, t]));
    const nameToId = new Map(tokens.map((t) => [t.name, t.id]));

    const startTs = todayMidnightSec();
    const endTs = Math.floor(Date.now() / 1000);
    // type=2 typically means "consume" log type in new-api. Pull a wide
    // size to avoid pagination round-trips on busy days; 5000 is a safe cap.
    const qs = new URLSearchParams({
      type: "2",
      start_timestamp: String(startTs),
      end_timestamp: String(endTs),
      p: "0",
      size: "5000",
    });
    const resp = await this.request<
      | {
          items?: NewApiLogRow[];
          data?: NewApiLogRow[];
          records?: NewApiLogRow[];
        }
      | NewApiLogRow[]
    >("GET", `/api/log/self?${qs.toString()}`);
    const rows: NewApiLogRow[] = Array.isArray(resp)
      ? resp
      : (resp.items ?? resp.records ?? resp.data ?? []);

    // Aggregate today's quota by token_id (via token_name → id lookup).
    const todayByTokenId = new Map<number, number>();
    for (const r of rows) {
      const name = r.token_name ?? r.tokenName ?? "";
      const tid = nameToId.get(name);
      if (tid == null) continue;
      const q = Number(r.quota ?? 0);
      todayByTokenId.set(tid, (todayByTokenId.get(tid) ?? 0) + q);
    }

    const out: Record<string, KeyUsageItem> = {};
    for (const id of ids) {
      const today = (todayByTokenId.get(id) ?? 0) / QUOTA_PER_USD;
      const total = (tokensById.get(id)?.used_quota ?? 0) / QUOTA_PER_USD;
      out[String(id)] = {
        api_key_id: id,
        today_actual_cost: today,
        total_actual_cost: total,
      };
    }
    return out;
  }

  // Per-key historical usage between two YYYY-MM-DD dates (inclusive).
  // Used by the historical backfill flow. newapi has no dedicated stats
  // endpoint, so we paginate /api/log/self filtered by token_name + the
  // date range and aggregate quota.
  //
  // The sub2api shape returns BOTH total_cost (1× base) and
  // total_actual_cost (× user rate). On newapi the log's `quota` is the
  // already-charged amount → that's the actual_cost. We derive 1× base
  // by dividing by the token's current group rate (best-effort; historical
  // rate changes aren't tracked).
  async getKeyUsageStats(
    apiKeyId: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    total_requests: number;
    total_cost: number;
    total_actual_cost: number;
    total_tokens?: number;
  }> {
    if (!this.tokensCache) await this.listKeys();
    const token = this.tokensCache?.find((t) => t.id === apiKeyId);
    if (!token) {
      return { total_requests: 0, total_cost: 0, total_actual_cost: 0 };
    }

    const startMs = Date.parse(`${startDate}T00:00:00+08:00`);
    const endMs = Date.parse(`${endDate}T00:00:00+08:00`) + 86_400_000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error(`bad date range: ${startDate}..${endDate}`);
    }
    const startTs = Math.floor(startMs / 1000);
    const endTs = Math.floor(endMs / 1000);

    let totalQuota = 0;
    let totalRequests = 0;
    let totalTokens = 0;
    // No safety bound — paginate until the server returns a short page.
    // High-traffic tokens may produce hundreds of thousands of entries; we
    // need them all for an accurate backfill.
    const PAGE_SIZE = 5000;
    for (let p = 0; ; p++) {
      const qs = new URLSearchParams({
        type: "2",
        token_name: token.name,
        start_timestamp: String(startTs),
        end_timestamp: String(endTs),
        p: String(p),
        size: String(PAGE_SIZE),
      });
      const resp = await this.request<
        | {
            items?: NewApiLogRow[];
            data?: NewApiLogRow[];
            records?: NewApiLogRow[];
          }
        | NewApiLogRow[]
      >("GET", `/api/log/self?${qs.toString()}`);
      const rows: NewApiLogRow[] = Array.isArray(resp)
        ? resp
        : (resp.items ?? resp.records ?? resp.data ?? []);
      if (rows.length === 0) break;
      for (const r of rows) {
        totalQuota += Number(r.quota ?? 0);
        totalRequests++;
        const pt = Number(
          (r as { prompt_tokens?: number }).prompt_tokens ?? 0,
        );
        const ct = Number(
          (r as { completion_tokens?: number }).completion_tokens ?? 0,
        );
        totalTokens += pt + ct;
      }
      if (rows.length < PAGE_SIZE) break;
    }

    const actualCost = totalQuota / QUOTA_PER_USD;
    // Estimate 1× base via current group rate (good enough; historical
    // rate changes are rare in practice).
    let rate = 1;
    try {
      const rates = await this.getUserGroupRates();
      const r = rates[token.group || ""];
      if (typeof r === "number" && r > 0) rate = r;
    } catch {
      // ignore — fall back to 1×
    }
    return {
      total_requests: totalRequests,
      total_cost: rate > 0 ? actualCost / rate : actualCost,
      total_actual_cost: actualCost,
      total_tokens: totalTokens,
    };
  }

  async getUserGroupRates(): Promise<Record<string | number, number>> {
    type GroupRow = { ratio?: number | string; desc?: string };
    const data = await this.request<Record<string, GroupRow>>(
      "GET",
      `/api/user/self/groups`,
    );
    const out: Record<string | number, number> = {};
    if (data && typeof data === "object") {
      for (const [name, row] of Object.entries(data)) {
        if (!row || typeof row !== "object") continue;
        const r = row.ratio;
        // "自动" 等字符串归一为 1.0；数字直接读
        const num = typeof r === "number" ? r : Number(r);
        if (Number.isFinite(num) && num > 0) out[name] = num;
        else out[name] = 1;
      }
    }
    return out;
  }
}
