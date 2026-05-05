// Default rule config and parsing helpers for the az batch tool.
// Stored as JSON string on AzPreset.config; client and server share this shape.

// Maps to sub2api credentials.temp_unschedulable_rules item.
// On match (error code + any keyword), the channel is auto-paused for
// `duration_minutes` then re-eligible for dispatch.
export interface TempUnschedulableRule {
  error_code: number;
  keywords: string[];
  duration_minutes: number;
  description: string;
}

export interface AzConfig {
  // Account creation defaults
  platform: string;
  type: string;
  concurrency: number;
  priority: number;
  rate_multiplier: number;
  group_ids: number[];
  confirm_mixed_channel_risk: boolean;
  model_mapping: Record<string, string>;

  // Naming
  account_prefix: string;
  account_start_index: number;
  proxy_prefix: string;
  proxy_start_index: number;

  // Proxy
  proxy_protocol: string;
  auto_bind_proxy: boolean;

  // Temporary auto-pause on error+keyword match.
  // Replaces the old `custom_error_codes` flat list.
  temp_unschedulable_enabled: boolean;
  temp_unschedulable_rules: TempUnschedulableRule[];
}

export const DEFAULT_AZ_CONFIG: AzConfig = {
  platform: "anthropic",
  type: "apikey",
  concurrency: 20,
  priority: 1,
  rate_multiplier: 1,
  group_ids: [],
  confirm_mixed_channel_risk: true,
  model_mapping: {
    "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
    "claude-opus-4-1-20250805": "claude-opus-4-1-20250805",
    "claude-opus-4-5-20251101": "claude-opus-4-5-20251101",
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-opus-4-7": "claude-opus-4-7",
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
  },
  account_prefix: "az-",
  account_start_index: 1,
  proxy_prefix: "proxy-",
  proxy_start_index: 1,
  proxy_protocol: "socks5",
  auto_bind_proxy: true,
  temp_unschedulable_enabled: true,
  temp_unschedulable_rules: [
    {
      error_code: 400,
      keywords: ["has been blocked"],
      duration_minutes: 120,
      description: "",
    },
  ],
};

export function readConfig(json: string | null | undefined): AzConfig {
  if (!json) return DEFAULT_AZ_CONFIG;
  try {
    const parsed = JSON.parse(json) as Partial<AzConfig>;
    return { ...DEFAULT_AZ_CONFIG, ...parsed };
  } catch {
    return DEFAULT_AZ_CONFIG;
  }
}

// === Parsing user input ===

export interface ParsedAccount {
  base_url: string;
  api_key: string;
  warnings: string[];
  // index in input (1-based) for showing back to the user
  index: number;
}

const V1_MESSAGES_RE = /\/v1\/messages\/?$/i;

export function parseAccountText(text: string): ParsedAccount[] {
  // Strategy: try CSV "base_url,api_key" per line first; if any line has a
  // comma, treat the whole input as CSV. Otherwise fall back to "alternating
  // line" mode (URL on one line, key on the next).
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const looksCsv = lines.some(
    (l) => l.includes(",") && !l.startsWith("#"),
  );

  const out: ParsedAccount[] = [];
  if (looksCsv) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("#") || /^base_url\s*,/i.test(l)) continue;
      const [u, k] = l.split(",").map((s) => s.trim());
      if (!u || !k) continue;
      out.push(normalizeAccount(u, k, out.length + 1));
    }
  } else {
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const u = lines[i];
      const k = lines[i + 1];
      if (!u || !k) continue;
      out.push(normalizeAccount(u, k, out.length + 1));
    }
  }
  return out;
}

function normalizeAccount(
  rawUrl: string,
  rawKey: string,
  index: number,
): ParsedAccount {
  const warnings: string[] = [];
  let url = rawUrl.trim();
  if (V1_MESSAGES_RE.test(url)) {
    warnings.push("自动剥离了 /v1/messages 后缀");
    url = url.replace(V1_MESSAGES_RE, "");
  }
  if (url.endsWith("/")) url = url.replace(/\/+$/, "");
  return { base_url: url, api_key: rawKey.trim(), warnings, index };
}

export interface ParsedProxy {
  host: string;
  port: number;
  username: string;
  password: string;
  index: number;
  warnings: string[];
}

export function parseProxyText(text: string): ParsedProxy[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedProxy[] = [];
  for (const l of lines) {
    if (l.startsWith("#")) continue;
    // Accept either ":" or "," as delimiter, and 2~4 fields:
    //   host:port
    //   host:port:user:pass
    //   host,port,user,pass
    const sep = l.includes(",") ? "," : ":";
    const parts = l.split(sep).map((s) => s.trim());
    if (parts.length < 2) continue;
    const host = parts[0];
    const port = Number(parts[1]);
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) continue;
    const username = parts[2] || "";
    const password = parts[3] || "";
    out.push({
      host,
      port,
      username,
      password,
      index: out.length + 1,
      warnings: [],
    });
  }
  return out;
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

// Compute next az-N number from an existing list of names.
export function nextSequenceNumber(
  existing: string[],
  prefix: string,
  startIndex: number,
): number {
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  let max = startIndex - 1;
  for (const n of existing) {
    const m = n.match(re);
    if (m) {
      const num = Number(m[1]);
      if (num > max) max = num;
    }
  }
  return max + 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
