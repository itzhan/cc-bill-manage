// Adapter for sub2api-style relay sites.
// Endpoints used:
//   POST /api/v1/auth/login                              -> token + user info
//   GET  /api/v1/keys                                     -> user's API keys + groups
//   POST /api/v1/usage/dashboard/api-keys-usage           -> per-key today/total cost
//   GET  /api/v1/admin/accounts                           -> admin: upstream account list
//   POST /api/v1/admin/accounts/today-stats/batch         -> admin: per-account today stats

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  userId: number;
  username: string;
  role: string;
}

export interface KeyGroup {
  id: number;
  name: string;
  rate_multiplier: number;
}

export interface KeyItem {
  id: number;
  user_id: number;
  key: string; // already masked or full depending on server
  name: string;
  // newer sub2api versions may omit top-level group_id; nested group.id is authoritative
  group_id?: number;
  group?: KeyGroup;
}

export interface KeyUsageItem {
  api_key_id: number;
  today_actual_cost: number;
  total_actual_cost: number;
}

export interface AdminAccountGroup {
  id: number;
  name: string;
  rate_multiplier: number;
}

export interface AdminAccount {
  id: number;
  name: string;
  rate_multiplier: number;
  groups: AdminAccountGroup[];
  // optional fields used by az tooling — not all listAdmin* responses
  // include every one; treat as optional on the consuming side.
  status?: string;
  concurrency?: number;
  priority?: number;
  group_ids?: number[];
  proxy_id?: number | null;
  error_message?: string | null;
  last_used_at?: string | null;
  credentials?: Record<string, unknown>;
}

export interface AdminUser {
  id: number;
  email: string;
  username: string;
  role: string;
  status: string;
  balance: number;
  // Lifetime recharged amount — already returned by GET /admin/users on
  // newer sub2api builds, so we don't need /balance-history per user.
  total_recharged?: number;
  notes?: string | null;
  last_active_at?: string | null;
  last_used_at?: string | null;
  created_at?: string | null;
}

export interface BalanceHistoryResp {
  items: unknown[];
  total: number;
  total_recharged: number;
  page: number;
  page_size: number;
}

export interface AdminAccountStat {
  requests: number;
  tokens: number;
  cost: number;
  standard_cost: number;
  user_cost: number;
}

interface Sub2ApiRawEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface Sub2ApiCredsState {
  baseUrl: string;
  email: string;
  password: string;
  // Admin api key. When set, requests use `x-api-key` header instead of
  // logging in for a JWT — no expiry, no relogin path. email/password
  // become record-only.
  apiKey?: string | null;
  accessToken?: string | null;
}

export interface Sub2ApiPersistHook {
  onTokenRefreshed?: (newToken: string, expiresInSec: number) => Promise<void>;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export class Sub2ApiClient {
  private base: string;
  constructor(
    private readonly creds: Sub2ApiCredsState,
    private readonly hook: Sub2ApiPersistHook = {},
  ) {
    this.base = trimSlash(creds.baseUrl);
  }

  async login(): Promise<LoginResult> {
    const res = await fetch(`${this.base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: this.creds.email,
        password: this.creds.password,
      }),
      // sub2api may use http and self-signed certs; rely on Node's defaults.
    });
    if (!res.ok) {
      throw new Error(`login http ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Sub2ApiRawEnvelope<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: number; username: string; role: string };
    }>;
    if (json.code !== 0) {
      throw new Error(`login failed: ${json.message}`);
    }
    const result: LoginResult = {
      accessToken: json.data.access_token,
      refreshToken: json.data.refresh_token,
      expiresInSec: json.data.expires_in,
      userId: json.data.user.id,
      username: json.data.user.username,
      role: json.data.user.role,
    };
    this.creds.accessToken = result.accessToken;
    if (this.hook.onTokenRefreshed) {
      await this.hook.onTokenRefreshed(result.accessToken, result.expiresInSec);
    }
    return result;
  }

  private async ensureToken() {
    if (this.creds.apiKey) return; // x-api-key path: no token needed
    if (!this.creds.accessToken) await this.login();
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    await this.ensureToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.creds.apiKey) {
      headers["x-api-key"] = this.creds.apiKey;
    } else {
      headers.Authorization = `Bearer ${this.creds.accessToken}`;
    }
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
      // x-api-key never expires — surface the auth error directly.
      if (this.creds.apiKey) {
        throw new Error(`x-api-key auth failed: ${res.status}`);
      }
      if (retried) {
        throw new Error(`auth still failing after relogin: ${res.status}`);
      }
      this.creds.accessToken = null;
      await this.login();
      return this.request<T>(method, path, body, true);
    }
    if (!res.ok) {
      throw new Error(`http ${res.status} ${path}: ${await res.text()}`);
    }
    const json = (await res.json()) as Sub2ApiRawEnvelope<T>;
    if (json.code !== 0) {
      throw new Error(`${path} api error: ${json.message}`);
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
    return this.request<{
      id: number;
      email: string;
      username: string;
      balance: number;
      role: string;
    }>("GET", `/api/v1/auth/me?timezone=Asia%2FShanghai`);
  }

  async listKeys(): Promise<KeyItem[]> {
    const data = await this.request<{ items: KeyItem[]; total: number }>(
      "GET",
      `/api/v1/keys?page=1&page_size=200&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai`,
    );
    return data.items || [];
  }

  /**
   * Returns map of groupId -> per-user exclusive rate multiplier override.
   * If a group is not in the returned map, the group's default
   * `rate_multiplier` should be used instead.
   */
  async getUserGroupRates(): Promise<Record<number, number>> {
    const data = await this.request<Record<string, number> | null>(
      "GET",
      `/api/v1/groups/rates?timezone=Asia%2FShanghai`,
    );
    const out: Record<number, number> = {};
    if (data && typeof data === "object") {
      for (const [k, v] of Object.entries(data)) {
        const id = Number(k);
        const rate = Number(v);
        if (Number.isFinite(id) && Number.isFinite(rate)) out[id] = rate;
      }
    }
    return out;
  }

  // Per-key historical usage between two YYYY-MM-DD dates (inclusive).
  // Used by the historical backfill flow.
  async getKeyUsageStats(
    apiKeyId: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    total_requests: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_actual_cost: number;
    total_tokens?: number;
  }> {
    return this.request(
      "GET",
      `/api/v1/usage/stats?start_date=${startDate}&end_date=${endDate}&api_key_id=${apiKeyId}&timezone=Asia%2FShanghai`,
    );
  }

  // Per-USER historical usage. Same endpoint as account stats but with
  // user_id filter. Returns total_cost (1×) and total_actual_cost (× rate).
  async getAdminUserUsageStats(
    userId: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    total_requests: number;
    total_cost: number;
    total_actual_cost: number;
    total_tokens?: number;
  }> {
    return this.request(
      "GET",
      `/api/v1/admin/usage/stats?start_date=${startDate}&end_date=${endDate}&user_id=${userId}&timezone=Asia%2FShanghai`,
    );
  }

  // Per-admin-account historical usage, used on the SITE side.
  async getAdminAccountUsageStats(
    accountId: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    total_requests: number;
    total_cost: number;
    total_actual_cost: number;
    total_account_cost?: number;
    total_tokens?: number;
  }> {
    return this.request(
      "GET",
      `/api/v1/admin/usage/stats?start_date=${startDate}&end_date=${endDate}&account_id=${accountId}&timezone=Asia%2FShanghai`,
    );
  }

  async getKeysUsage(ids: number[]): Promise<Record<string, KeyUsageItem>> {
    if (!ids.length) return {};
    const data = await this.request<{ stats: Record<string, KeyUsageItem> }>(
      "POST",
      `/api/v1/usage/dashboard/api-keys-usage`,
      { api_key_ids: ids },
    );
    return data.stats || {};
  }

  async listAdminUsers(): Promise<AdminUser[]> {
    const data = await this.request<{ items: AdminUser[]; total: number }>(
      "GET",
      `/api/v1/admin/users?page=1&page_size=500&include_subscriptions=false&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai`,
    );
    return data.items;
  }

  async getUserBalanceHistory(
    userId: number,
  ): Promise<{ totalRecharged: number }> {
    // We only need the total_recharged aggregate; fetch a small page.
    const data = await this.request<BalanceHistoryResp>(
      "GET",
      `/api/v1/admin/users/${userId}/balance-history?page=1&page_size=1&timezone=Asia%2FShanghai`,
    );
    return { totalRecharged: data.total_recharged ?? 0 };
  }

  async listAdminProxiesAll(): Promise<
    Array<{
      id: number;
      name: string;
      protocol: string;
      host: string;
      port: number;
      username?: string;
      password?: string;
    }>
  > {
    return this.request("GET", `/api/v1/admin/proxies/all`);
  }

  async createAdminProxy(body: {
    name: string;
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
  }): Promise<{ id: number; name: string }> {
    return this.request("POST", `/api/v1/admin/proxies`, body);
  }

  async listAdminAccountsFiltered(
    params: {
      status?: string;
      search?: string;
      page?: number;
      page_size?: number;
    } = {},
  ): Promise<{ items: AdminAccount[]; total: number }> {
    const qs = new URLSearchParams();
    qs.set("page", String(params.page ?? 1));
    qs.set("page_size", String(params.page_size ?? 1000));
    qs.set("timezone", "Asia/Shanghai");
    if (params.status) qs.set("status", params.status);
    if (params.search) qs.set("search", params.search);
    return this.request(
      "GET",
      `/api/v1/admin/accounts?${qs.toString()}`,
    );
  }

  async createAdminAccount(body: Record<string, unknown>): Promise<{
    id: number;
    name: string;
  }> {
    return this.request("POST", `/api/v1/admin/accounts`, body);
  }

  async getAdminAccount(id: number): Promise<{
    id: number;
    name: string;
    credentials: Record<string, unknown>;
    status: string;
  }> {
    return this.request("GET", `/api/v1/admin/accounts/${id}`);
  }

  async updateAdminAccount(
    id: number,
    body: Record<string, unknown>,
  ): Promise<{ id: number; name: string }> {
    return this.request("PUT", `/api/v1/admin/accounts/${id}`, body);
  }

  async deleteAdminAccount(id: number): Promise<unknown> {
    return this.request("DELETE", `/api/v1/admin/accounts/${id}`);
  }

  async bulkUpdateAdminAccounts(body: {
    account_ids: number[];
    [k: string]: unknown;
  }): Promise<{ updated: number } | unknown> {
    return this.request("POST", `/api/v1/admin/accounts/bulk-update`, body);
  }

  async clearAdminAccountsError(
    ids: number[],
  ): Promise<{ cleared: number } | unknown> {
    return this.request("POST", `/api/v1/admin/accounts/batch-clear-error`, {
      account_ids: ids,
    });
  }

  async getAdminAccountStats(
    id: number,
    days = 30,
  ): Promise<{
    total_cost: number;
    total_actual_cost?: number;
    total_tokens: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_requests?: number;
  }> {
    return this.request(
      "GET",
      `/api/v1/admin/accounts/${id}/stats?days=${days}`,
    );
  }

  async listAdminAccounts(): Promise<AdminAccount[]> {
    const data = await this.request<{ items: AdminAccount[]; total: number }>(
      "GET",
      `/api/v1/admin/accounts?page=1&page_size=200&platform=&type=&status=&privacy_mode=&group=&search=&sort_by=name&sort_order=desc&lite=1&timezone=Asia%2FShanghai`,
    );
    return data.items || [];
  }

  async getAccountsStats(
    ids: number[],
  ): Promise<Record<string, AdminAccountStat>> {
    if (!ids.length) return {};
    const data = await this.request<{ stats: Record<string, AdminAccountStat> }>(
      "POST",
      `/api/v1/admin/accounts/today-stats/batch`,
      { account_ids: ids },
    );
    return data.stats || {};
  }

  // ============================================================
  // Resource scheduling (used by /scheduling page)
  // ============================================================

  // Real-time concurrency snapshot. Server-side Redis aggregation; very fast.
  // Real shape (verified live): account map keyed by account_id with
  // current_in_use / max_capacity / load_percentage / waiting_in_queue,
  // plus group_id and group_name on each row.
  async getOpsConcurrency(): Promise<{
    account?: Record<
      string,
      {
        account_id: number;
        account_name?: string;
        platform?: string;
        group_id?: number;
        group_name?: string;
        current_in_use: number;
        max_capacity: number;
        load_percentage?: number;
        waiting_in_queue?: number;
      }
    >;
  }> {
    return this.request("GET", `/api/v1/admin/ops/concurrency`);
  }

  // Bulk per-user today + lifetime cost in a single call. Replaces the
  // pattern of fanning out /admin/usage/stats?user_id=N per user.
  // Sub2api requires user_ids in the body (otherwise 400).
  async getUsersUsage(
    userIds: number[],
  ): Promise<
    Record<
      string,
      {
        user_id: number;
        today_actual_cost: number;
        today_cost?: number;
        total_actual_cost?: number;
      }
    >
  > {
    if (!userIds.length) return {};
    const data = await this.request<{
      stats:
        | Record<
            string,
            {
              user_id: number;
              today_actual_cost: number;
              today_cost?: number;
              total_actual_cost?: number;
            }
          >
        | Array<{
            user_id: number;
            today_actual_cost: number;
            today_cost?: number;
            total_actual_cost?: number;
          }>;
    }>("POST", `/api/v1/admin/dashboard/users-usage`, {
      user_ids: userIds,
    });
    // Server may return either array or object. Normalise to object.
    const out: Record<
      string,
      {
        user_id: number;
        today_actual_cost: number;
        today_cost?: number;
        total_actual_cost?: number;
      }
    > = {};
    if (Array.isArray(data.stats)) {
      for (const s of data.stats) out[String(s.user_id)] = s;
    } else if (data.stats) {
      for (const [k, v] of Object.entries(data.stats)) out[k] = v;
    }
    return out;
  }

  async listAdminGroupsAll(): Promise<
    Array<{
      id: number;
      name: string;
      description?: string;
      platform: string;
      status: string;
      is_exclusive?: boolean;
      rate_multiplier: number;
      subscription_type?: string;
      daily_limit_usd?: number;
      weekly_limit_usd?: number;
      monthly_limit_usd?: number;
      created_at?: string;
      updated_at?: string;
    }>
  > {
    return this.request("GET", `/api/v1/admin/groups/all`);
  }

  async getAccountModels(id: number): Promise<
    Array<{ id: string; display_name?: string; type?: string }>
  > {
    return this.request("GET", `/api/v1/admin/accounts/${id}/models`);
  }

  // Test endpoint returns SSE; we don't need streaming on the admin side —
  // we just want to know whether it succeeded. Read the response as text and
  // detect failure markers. Bypasses the JSON envelope path because SSE.
  async testAdminAccount(
    id: number,
    body: { model_id?: string; prompt?: string; mode?: string } = {},
  ): Promise<{ ok: boolean; output: string }> {
    if (!this.creds.apiKey && !this.creds.accessToken) await this.login();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.creds.apiKey) {
      headers["x-api-key"] = this.creds.apiKey;
    } else {
      headers.Authorization = `Bearer ${this.creds.accessToken}`;
    }
    const res = await fetch(
      `${this.base}/api/v1/admin/accounts/${id}/test`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, output: text.slice(0, 800) };
    }
    // SSE stream: success usually finishes with `event: done` or `[DONE]`,
    // failure carries an `error` event payload. Use coarse heuristic.
    const failed =
      /\bevent:\s*error\b/i.test(text) ||
      /"error"\s*:/.test(text) ||
      /"code"\s*:\s*[1-9]/.test(text);
    return { ok: !failed, output: text.slice(-1500) };
  }

  // Toggle "participate in dispatch" (schedulable). Distinct from status:
  // when false, the dispatcher excludes the account regardless of status.
  async setAccountSchedulable(
    id: number,
    schedulable: boolean,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/admin/accounts/${id}/schedulable`,
      { schedulable },
    );
  }

  // Per-user cost breakdown for a single group on a date range.
  // One HTTP call returns all users in that group with per-user cost fields.
  async getGroupUserBreakdown(
    groupId: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    users: Array<{
      user_id: number;
      email?: string;
      requests: number;
      total_tokens: number;
      cost: number;
      actual_cost: number;
      account_cost?: number;
    }>;
  }> {
    const qs = new URLSearchParams({
      group_id: String(groupId),
      start_date: startDate,
      end_date: endDate,
      timezone: "Asia/Shanghai",
      limit: "200",
    });
    return this.request(
      "GET",
      `/api/v1/admin/dashboard/user-breakdown?${qs.toString()}`,
    );
  }

  // List request-error events. The sub2api admin page paginates this (max
  // page_size = 500). For ranking aggregation, callers page until total is
  // covered; we don't fold paging here so the caller can stream + cap.
  async listRequestErrors(params: {
    page?: number;
    pageSize?: number;
    timeRange?: string;
    view?: string;
  } = {}): Promise<{
    items: Array<{
      id: number;
      created_at: string;
      status_code: number;
      platform?: string;
      model?: string;
      account_id?: number;
      account_name?: string;
      group_id?: number;
      group_name?: string;
      requested_model?: string;
      message?: string;
      user_id?: number;
      user_email?: string;
      severity?: string;
      type?: string;
    }>;
    total: number;
    page: number;
    page_size: number;
    pages: number;
  }> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      page_size: String(params.pageSize ?? 500),
      time_range: params.timeRange ?? "1h",
      view: params.view ?? "errors",
      timezone: "Asia/Shanghai",
    });
    return this.request("GET", `/api/v1/admin/ops/request-errors?${qs.toString()}`);
  }

  // Bulk fetch usage stats per group (per day). Used to sort groups by today
  // consumption. Fall back to per-account aggregation if this 404s on older
  // sub2api builds.
  async getGroupUsageStatsToday(
    groupId: number,
    today: string,
  ): Promise<{ total_actual_cost?: number; total_cost?: number; total_requests?: number; total_tokens?: number }> {
    const qs = new URLSearchParams({
      group_id: String(groupId),
      start_date: today,
      end_date: today,
      timezone: "Asia/Shanghai",
    });
    return this.request("GET", `/api/v1/admin/usage/stats?${qs.toString()}`);
  }
}
