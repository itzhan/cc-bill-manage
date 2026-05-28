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

// new-api 的 quota → USD 换算因子: 上游可以在 settings 里改 (common.QuotaPerUnit
// 不是常量, 是 operation_setting), 不同部署可能差 10 倍 (500_000 vs 50_000)。
// 写死 500_000 → 计费会差 10 倍 (例: 暖冬的实例就是这种情况)。改成开启
// 每次 listKeys / getMe 前从 /api/status?quota_per_unit 拉一次, 缓存到实例上。
// 这是公开接口不要 auth, 一次 client 实例只查一次。
const DEFAULT_QUOTA_PER_USD = 500_000;

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
  // 用户自身分组(/api/user/self.group)。new-api 计费在 token.group==""
  // 时实际用 userGroup 算费率(middleware/auth.go:383-398); 我们的费率换算
  // 必须用这个 fallback 才能跟上游真实扣费一致。getMe / listKeys 调用时
  // 自动更新这个缓存。
  private userGroup: string | null = null;
  // quota → USD 换算因子。从上游 /api/status 拿, 上游可改。第一次用之前
  // 现拉, 之后整个 client 实例复用。失败回退默认 500_000。
  private quotaPerUsd: number | null = null;

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
      // newapi convention: `quota` on /user/self is the **current remaining**
      // (it decreases as the user spends), NOT lifetime allocation. So
      // balance = quota / quotaPerUsd directly.
      // `used_quota` is lifetime consumption — useful for dashboards but
      // unrelated to the remaining-balance figure.
      quota: number;
      used_quota: number;
      group?: string;
    }>("GET", `/api/user/self`);
    // 缓存用户分组, 给 listKeys 用作 token.group==="" 时的费率 fallback。
    if (typeof data.group === "string" && data.group) {
      this.userGroup = data.group;
    }
    const quotaPerUsd = await this.getQuotaPerUsd();
    return {
      id: data.id,
      email: data.email ?? this.creds.email,
      username: data.username,
      balance: Math.max(0, data.quota ?? 0) / quotaPerUsd,
      role: data.role >= 10 ? "admin" : "user",
    };
  }

  // 从 new-api /api/status 拿 quota_per_unit (这是公开接口, 不要 auth)。
  // 500_000 是默认值, 但很多部署改成 50_000, 写死会让费用差 10 倍。
  private async getQuotaPerUsd(): Promise<number> {
    if (this.quotaPerUsd != null) return this.quotaPerUsd;
    try {
      const res = await fetch(`${this.base}/api/status`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const j = (await res.json()) as {
          data?: { quota_per_unit?: number };
        };
        const v = Number(j?.data?.quota_per_unit);
        if (Number.isFinite(v) && v > 0) {
          this.quotaPerUsd = v;
          return v;
        }
      }
    } catch (e) {
      console.warn(
        `[newapi] /api/status quota_per_unit fetch failed, falling back to ${DEFAULT_QUOTA_PER_USD}:`,
        e instanceof Error ? e.message : e,
      );
    }
    this.quotaPerUsd = DEFAULT_QUOTA_PER_USD;
    return this.quotaPerUsd;
  }

  // 用户自己的 default 分组(/api/user/self.group)。listKeys 在 token.group
  // 为空时用它来标注 group 名 — 因为 new-api 计费就是用这个 group 的费率,
  // 我们的 userRates 查询必须用同样的 name 才对得上号。
  private async getUserGroup(): Promise<string> {
    if (this.userGroup) return this.userGroup;
    // 触发一次 getMe 刷新缓存(代价低, 顺便也确认 session 还活)。
    try {
      await this.getMe();
    } catch {
      // ignore — fall back to "default" below
    }
    return this.userGroup || "default";
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
    // new-api 列表接口返回的 key 字段是已 mask 过的 (controller/token.go
    // buildMaskedTokenResponse → token.GetMaskedKey)。要拿完整 key 必须再
    // 调 POST /api/token/batch/keys (限 100 id/批)。否则我们存到 DB 的
    // apiKey 永远是 null, 后续"加入本站"等需要 raw key 的功能会失败。
    const fullKeysById = await this.fetchFullKeys(tokens.map((t) => t.id));
    // 用户的 default 分组 — token.group 为空时计费实际用这个 (middleware/
    // auth.go:383-398), 我们的 groupName 也必须落到同一个 key 上, 否则
    // userRates 查表对不上号, effectiveRateMultiplier 会错算成 1, 1× 基价
    // 就会算成 actual cost (而不是 actual / 真实费率)。
    const userGroup = await this.getUserGroup();
    return tokens.map((t) => ({
      id: t.id,
      user_id: t.user_id,
      key: fullKeysById.get(t.id) ?? t.key,
      name: t.name,
      // newapi has no group_id concept; we leave 0 and put the name on
      // the group struct so refreshUpstreamAccount's rate lookup uses name.
      group_id: 0,
      group: {
        id: 0,
        // token.group 为空 → 用 user 自身分组; token.group 非空且不是 "auto"
        // → 用 token.group; "auto" 没法预测真实路由, 退回 user 分组兜底
        name:
          !t.group || t.group === "auto" ? userGroup : t.group,
        // Filled by refreshUpstreamAccount via getUserGroupRates output.
        // Default to 1 so behavior degrades gracefully if rates missing.
        rate_multiplier: 1,
      },
    }));
  }

  // 批量获取完整 key, 走 new-api 的 POST /api/token/batch/keys。
  // 限 100/批, 我们分块跑;不报错 (老版本可能没这个接口) — 失败的就回退
  // 到 masked, 用户后续重试即可。
  private async fetchFullKeys(ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const resp = await this.request<{ keys: Record<string, string> }>(
          "POST",
          "/api/token/batch/keys",
          { ids: chunk },
        );
        for (const [k, v] of Object.entries(resp.keys ?? {})) {
          if (typeof v === "string" && v.length > 0) {
            out.set(Number(k), v);
          }
        }
      } catch (e) {
        console.warn(
          `[newapi] fetchFullKeys batch failed (chunk ${i}/${ids.length}):`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    return out;
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

    const quotaPerUsd = await this.getQuotaPerUsd();
    const out: Record<string, KeyUsageItem> = {};
    for (const id of ids) {
      const today = (todayByTokenId.get(id) ?? 0) / quotaPerUsd;
      const total = (tokensById.get(id)?.used_quota ?? 0) / quotaPerUsd;
      out[String(id)] = {
        api_key_id: id,
        today_actual_cost: today,
        total_actual_cost: total,
      };
    }
    return out;
  }

  // Per-key historical usage between two YYYY-MM-DD dates (inclusive).
  // Used by the historical backfill flow.
  //
  // 服务端聚合的 /api/log/self/stat?type=0 直接返回区间内 token 的总 quota，
  // 跟控制台看到的「花费」数字一致。我们之前翻页 /api/log/self?type=2 是只
  // 算 type=2 的消费日志，会漏掉其他类型 → 总额偏小，回填后利润看起来比真
  // 实更高（亏损被吃掉）。
  //
  // sub2api 返回 total_cost (1×) 和 total_actual_cost (×rate)。newapi 这边
  // stat 给的就是 actual_cost；1× base 用 token 的当前 group rate 反推（历史
  // 上倍率变更很少，best-effort 就够）。
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
      // 之前是静默返回 0 → 回填时上游某把 key 失踪会悄悄把 expense 算成 0，
      // 让那一天利润看起来虚高甚至变成正利润，且 errors[] 不会捕获。改成抛错
      // 触发上层 errors[] 记录 + 跳过 upsert（在 history.backfillRange 里）。
      throw new Error(
        `newapi: bound key ${apiKeyId} not found in account tokensCache — account may need re-login, or the key was deleted upstream`,
      );
    }

    const startMs = Date.parse(`${startDate}T00:00:00+08:00`);
    const endMs = Date.parse(`${endDate}T00:00:00+08:00`) + 86_400_000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error(`bad date range: ${startDate}..${endDate}`);
    }
    const startTs = Math.floor(startMs / 1000);
    const endTs = Math.floor(endMs / 1000);

    const qs = new URLSearchParams({
      type: "0",
      token_name: token.name,
      model_name: "",
      start_timestamp: String(startTs),
      end_timestamp: String(endTs),
      group: "",
    });
    const resp = await this.request<{
      data?: { quota?: number; rpm?: number; tpm?: number };
      success?: boolean;
    }>("GET", `/api/log/self/stat?${qs.toString()}`);
    const totalQuota = Number(resp?.data?.quota ?? 0);

    const quotaPerUsd = await this.getQuotaPerUsd();
    const actualCost = totalQuota / quotaPerUsd;
    // Estimate 1× base via current group rate (good enough; historical
    // rate changes are rare in practice). token.group 为空时跟 listKeys
    // 一样退回 user 分组(计费实际用的就是这个 — middleware/auth.go:383)。
    let rate = 1;
    try {
      const rates = await this.getUserGroupRates();
      const tg = token.group || (await this.getUserGroup());
      const r = rates[tg];
      if (typeof r === "number" && r > 0) rate = r;
    } catch {
      // ignore — fall back to 1×
    }
    return {
      total_requests: 0, // /stat doesn't expose request count
      total_cost: rate > 0 ? actualCost / rate : actualCost,
      total_actual_cost: actualCost,
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
