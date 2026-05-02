// Precise money: keeps full digits — used for unit prices and tooltips.
export function fmtMoney(n: number, digits = 4): string {
  if (n == null || isNaN(n)) return "-";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Compact money for tables/cards: switches unit when large.
//   >= 10,000   → "1.23万"
//   >= 1,000    → "1.23k"
//   < 1,000     → "999.99"
//   < 0.01 (≠0) → "<0.01"
export function fmtMoneyShort(n: number, decimals = 2): string {
  if (n == null || isNaN(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(decimals)}万`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(decimals)}k`;
  if (abs > 0 && abs < 0.01) return `${sign}<0.01`;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

// Compact date: just MM-DD HH:mm for table rows.
export function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "-";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${m}-${day} ${h}:${mi}`;
}
