"use client";

import { Copy, Eye, EyeOff, KeyRound, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";

export default function ChannelCredsBlock({
  creds,
  loading,
  reveal,
  setReveal,
}: {
  creds: { baseUrl: string; apiKey: string } | null;
  loading: boolean;
  reveal: boolean;
  setReveal: (v: boolean) => void;
}) {
  async function copy(text: string, label: string) {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      toast.success(`${label} 已复制`);
    } else {
      toast.error(`${label} 复制失败`);
    }
  }

  const masked = creds?.apiKey
    ? creds.apiKey.length > 8
      ? `${creds.apiKey.slice(0, 4)}…${creds.apiKey.slice(-4)}`
      : "*".repeat(creds.apiKey.length)
    : "";

  return (
    <div className="rounded-lg border border-border p-2.5 bg-muted/30 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Link2 size={12} className="text-muted-foreground/70 shrink-0" />
        <span className="text-[11px] text-muted-foreground shrink-0 w-10">
          URL
        </span>
        <code
          className="font-mono text-xs flex-1 truncate"
          title={creds?.baseUrl ?? ""}
        >
          {loading ? "加载中…" : creds?.baseUrl || "—"}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          className="h-6 w-6"
          disabled={!creds?.baseUrl}
          onClick={() => creds && copy(creds.baseUrl, "URL")}
          title="复制 URL"
        >
          <Copy size={12} />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <KeyRound size={12} className="text-muted-foreground/70 shrink-0" />
        <span className="text-[11px] text-muted-foreground shrink-0 w-10">
          Key
        </span>
        <code className="font-mono text-xs flex-1 truncate">
          {loading
            ? "加载中…"
            : !creds?.apiKey
              ? "—"
              : reveal
                ? creds.apiKey
                : masked}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          className="h-6 w-6"
          disabled={!creds?.apiKey}
          onClick={() => setReveal(!reveal)}
          title={reveal ? "隐藏" : "显示完整 key"}
        >
          {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="h-6 w-6"
          disabled={!creds?.apiKey}
          onClick={() => creds && copy(creds.apiKey, "API Key")}
          title="复制完整 key"
        >
          <Copy size={12} />
        </Button>
      </div>
    </div>
  );
}
