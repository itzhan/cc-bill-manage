"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface Settings {
  diffThreshold: number;
  syncIntervalMinutes: number;
  emailAlertEnabled: boolean;
  emailEndpoint: string;
  emailAuthToken: string | null;
  emailSenderEmail: string | null;
  emailSenderName: string | null;
  emailSenderAccountId: number | null;
  emailReceivers: string | null;
  emailSubject: string;
  emailCooldownMinutes: number;
  emailLastSentAt: string | null;
  errorRateAlertEnabled: boolean;
  errorRateThreshold: number;
  errorRateCooldownMinutes: number;
  errorRateLastSentAt: string | null;
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const j = await r.json();
      setS(j.settings);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("保存失败", { description: j.error });
        return;
      }
      toast.success("已保存");
    } finally {
      setSaving(false);
    }
  }

  async function changePw() {
    if (!oldPw || !newPw) return;
    const r = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error("修改失败", { description: j.error });
      return;
    }
    setOldPw("");
    setNewPw("");
    toast.success("已修改");
  }

  async function sendTest() {
    setTesting(true);
    try {
      const r = await fetch("/api/email/test", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("发送失败", { description: j.error });
        return;
      }
      toast.success("测试邮件已发送");
    } finally {
      setTesting(false);
    }
  }

  async function forceSend() {
    setForcing(true);
    try {
      const r = await fetch("/api/email/send-now", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error("发送失败", { description: j.error || j.reason });
        return;
      }
      toast.success("差异告警已发送");
      await load();
    } finally {
      setForcing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Shell>
      <h1 className="text-2xl font-bold mb-4">设置</h1>
      {loading || !s ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">同步</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>自动同步间隔（分钟）</Label>
                <Input
                  type="number"
                  value={String(s.syncIntervalMinutes)}
                  onChange={(e) =>
                    setS({ ...s, syncIntervalMinutes: Number(e.target.value) || 1 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>差异告警阈值（金额）</Label>
                <Input
                  type="number"
                  value={String(s.diffThreshold)}
                  onChange={(e) =>
                    setS({ ...s, diffThreshold: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                保存
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold">修改管理员密码</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>旧密码</Label>
                <Input
                  type="password"
                  value={oldPw}
                  onChange={(e) => setOldPw(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>新密码（至少 6 位）</Label>
                <Input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
              <Button onClick={changePw}>
                修改
              </Button>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row justify-between items-center">
              <div>
                <h2 className="font-semibold">邮件告警</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  上游 vs 本站 1x 差异超阈值时自动发送
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={s.emailAlertEnabled}
                  onCheckedChange={(v) => setS({ ...s, emailAlertEnabled: v })}
                />
                <Label>启用</Label>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>API 端点</Label>
                  <Input
                    value={s.emailEndpoint}
                    onChange={(e) => setS({ ...s, emailEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>主题</Label>
                  <Input
                    value={s.emailSubject}
                    onChange={(e) => setS({ ...s, emailSubject: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">可包含中文（如 xxx上游差异通知），实际差异金额会自动追加</p>
                </div>
                <div className="space-y-2">
                  <Label>发件人邮箱</Label>
                  <Input
                    placeholder="qiuming@aifun.edu.kg"
                    value={s.emailSenderEmail ?? ""}
                    onChange={(e) =>
                      setS({ ...s, emailSenderEmail: e.target.value || null })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>发件人名字</Label>
                  <Input
                    placeholder="qiuming"
                    value={s.emailSenderName ?? ""}
                    onChange={(e) =>
                      setS({ ...s, emailSenderName: e.target.value || null })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>发件人 accountId</Label>
                  <Input
                    type="number"
                    value={s.emailSenderAccountId?.toString() ?? ""}
                    onChange={(e) =>
                      setS({
                        ...s,
                        emailSenderAccountId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>冷却（分钟）</Label>
                  <Input
                    type="number"
                    value={String(s.emailCooldownMinutes)}
                    onChange={(e) =>
                      setS({ ...s, emailCooldownMinutes: Number(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">同一告警重发的最短间隔</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>授权 Token (Authorization header value)</Label>
                <Textarea
                  placeholder="eyJhbGciOi..."
                  rows={2}
                  value={s.emailAuthToken ?? ""}
                  onChange={(e) =>
                    setS({ ...s, emailAuthToken: e.target.value || null })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>收件人列表</Label>
                <Textarea
                  rows={2}
                  value={s.emailReceivers ?? ""}
                  onChange={(e) =>
                    setS({ ...s, emailReceivers: e.target.value || null })
                  }
                />
                <p className="text-xs text-muted-foreground">多个邮箱用英文逗号、分号或换行分隔</p>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-2 items-center">
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存
                </Button>
                <Button
                  variant="secondary"
                  onClick={sendTest}
                  disabled={testing}
                >
                  {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                  发送测试邮件
                </Button>
                <Button
                  variant="secondary"
                  onClick={forceSend}
                  disabled={forcing}
                >
                  {forcing && <Loader2 className="h-4 w-4 animate-spin" />}
                  立即发送差异告警
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                  上次发送：
                  {s.emailLastSentAt
                    ? new Date(s.emailLastSentAt).toLocaleString("zh-CN")
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row justify-between items-center flex-wrap gap-2">
              <div>
                <h2 className="font-semibold">请求错误率告警</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  各 sub2api 站点最近 1h 请求错误率超过阈值时发邮件（与差异告警用同一组邮件配置）
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={s.errorRateAlertEnabled}
                  onCheckedChange={(v) =>
                    setS({ ...s, errorRateAlertEnabled: v })
                  }
                />
                <Label>启用</Label>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>阈值（%）</Label>
                  <Input
                    type="number"
                    value={(s.errorRateThreshold * 100).toFixed(2)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setS({
                        ...s,
                        errorRateThreshold: Math.max(0, Math.min(100, n)) / 100,
                      });
                    }}
                    min={0}
                    max={100}
                    step={0.1}
                  />
                  <p className="text-xs text-muted-foreground">超过则触发；如 4 表示 4%</p>
                </div>
                <div className="space-y-2">
                  <Label>冷却（分钟）</Label>
                  <Input
                    type="number"
                    value={String(s.errorRateCooldownMinutes)}
                    onChange={(e) =>
                      setS({
                        ...s,
                        errorRateCooldownMinutes: Math.max(
                          0,
                          Math.floor(Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">同一告警重发的最短间隔</p>
                </div>
                <div className="flex items-end">
                  <span className="text-xs text-muted-foreground">
                    上次发送：
                    {s.errorRateLastSentAt
                      ? new Date(s.errorRateLastSentAt).toLocaleString("zh-CN")
                      : "—"}
                  </span>
                </div>
              </div>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                保存
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </Shell>
  );
}
