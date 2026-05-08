"use client";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Input,
  Spinner,
  Switch,
  Textarea,
  addToast,
} from "@heroui/react";
import Shell from "@/components/Shell";

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
        addToast({ title: "保存失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "已保存", color: "success" });
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
      addToast({ title: "修改失败", description: j.error, color: "danger" });
      return;
    }
    setOldPw("");
    setNewPw("");
    addToast({ title: "已修改", color: "success" });
  }

  async function sendTest() {
    setTesting(true);
    try {
      const r = await fetch("/api/email/test", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        addToast({ title: "发送失败", description: j.error, color: "danger" });
        return;
      }
      addToast({ title: "测试邮件已发送", color: "success" });
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
        addToast({
          title: "发送失败",
          description: j.error || j.reason,
          color: "danger",
        });
        return;
      }
      addToast({ title: "差异告警已发送", color: "success" });
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
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-content1 border border-divider/50 shadow-none">
            <CardHeader>
              <h2 className="font-semibold">同步</h2>
            </CardHeader>
            <CardBody className="gap-4">
              <Input
                type="number"
                label="自动同步间隔（分钟）"
                value={String(s.syncIntervalMinutes)}
                onValueChange={(v) =>
                  setS({ ...s, syncIntervalMinutes: Number(v) || 1 })
                }
              />
              <Input
                type="number"
                label="差异告警阈值（金额）"
                value={String(s.diffThreshold)}
                onValueChange={(v) =>
                  setS({ ...s, diffThreshold: Number(v) || 0 })
                }
              />
              <Button color="primary" onPress={save} isLoading={saving}>
                保存
              </Button>
            </CardBody>
          </Card>

          <Card className="bg-content1 border border-divider/50 shadow-none">
            <CardHeader>
              <h2 className="font-semibold">修改管理员密码</h2>
            </CardHeader>
            <CardBody className="gap-4">
              <Input
                type="password"
                label="旧密码"
                value={oldPw}
                onValueChange={setOldPw}
              />
              <Input
                type="password"
                label="新密码（至少 6 位）"
                value={newPw}
                onValueChange={setNewPw}
              />
              <Button color="primary" onPress={changePw}>
                修改
              </Button>
            </CardBody>
          </Card>

          <Card className="bg-content1 border border-divider/50 shadow-none md:col-span-2">
            <CardHeader className="flex justify-between items-center">
              <div>
                <h2 className="font-semibold">邮件告警</h2>
                <p className="text-xs text-default-500 mt-0.5">
                  上游 vs 本站 1× 差异超阈值时自动发送
                </p>
              </div>
              <Switch
                isSelected={s.emailAlertEnabled}
                onValueChange={(v) => setS({ ...s, emailAlertEnabled: v })}
              >
                启用
              </Switch>
            </CardHeader>
            <CardBody className="gap-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="API 端点"
                  value={s.emailEndpoint}
                  onValueChange={(v) => setS({ ...s, emailEndpoint: v })}
                />
                <Input
                  label="主题"
                  description="可包含中文（如 xxx上游差异通知），实际差异金额会自动追加"
                  value={s.emailSubject}
                  onValueChange={(v) => setS({ ...s, emailSubject: v })}
                />
                <Input
                  label="发件人邮箱"
                  placeholder="qiuming@aifun.edu.kg"
                  value={s.emailSenderEmail ?? ""}
                  onValueChange={(v) =>
                    setS({ ...s, emailSenderEmail: v || null })
                  }
                />
                <Input
                  label="发件人名字"
                  placeholder="qiuming"
                  value={s.emailSenderName ?? ""}
                  onValueChange={(v) =>
                    setS({ ...s, emailSenderName: v || null })
                  }
                />
                <Input
                  type="number"
                  label="发件人 accountId"
                  value={s.emailSenderAccountId?.toString() ?? ""}
                  onValueChange={(v) =>
                    setS({
                      ...s,
                      emailSenderAccountId: v ? Number(v) : null,
                    })
                  }
                />
                <Input
                  type="number"
                  label="冷却（分钟）"
                  description="同一告警重发的最短间隔"
                  value={String(s.emailCooldownMinutes)}
                  onValueChange={(v) =>
                    setS({ ...s, emailCooldownMinutes: Number(v) || 0 })
                  }
                />
              </div>
              <Textarea
                label="授权 Token (Authorization header value)"
                placeholder="eyJhbGciOi..."
                minRows={2}
                value={s.emailAuthToken ?? ""}
                onValueChange={(v) =>
                  setS({ ...s, emailAuthToken: v || null })
                }
              />
              <Textarea
                label="收件人列表"
                description="多个邮箱用英文逗号、分号或换行分隔"
                minRows={2}
                value={s.emailReceivers ?? ""}
                onValueChange={(v) =>
                  setS({ ...s, emailReceivers: v || null })
                }
              />
              <Divider />
              <div className="flex flex-wrap gap-2 items-center">
                <Button color="primary" onPress={save} isLoading={saving}>
                  保存
                </Button>
                <Button
                  variant="flat"
                  onPress={sendTest}
                  isLoading={testing}
                >
                  发送测试邮件
                </Button>
                <Button
                  variant="flat"
                  color="warning"
                  onPress={forceSend}
                  isLoading={forcing}
                >
                  立即发送差异告警
                </Button>
                <span className="text-xs text-default-500 ml-auto">
                  上次发送：
                  {s.emailLastSentAt
                    ? new Date(s.emailLastSentAt).toLocaleString("zh-CN")
                    : "—"}
                </span>
              </div>
            </CardBody>
          </Card>

          <Card className="bg-content1 border border-divider/50 shadow-none md:col-span-2">
            <CardHeader className="flex justify-between items-center flex-wrap gap-2">
              <div>
                <h2 className="font-semibold">请求错误率告警</h2>
                <p className="text-xs text-default-500 mt-0.5">
                  各 sub2api 站点最近 1h 请求错误率超过阈值时发邮件（与差异告警用同一组邮件配置）
                </p>
              </div>
              <Switch
                isSelected={s.errorRateAlertEnabled}
                onValueChange={(v) =>
                  setS({ ...s, errorRateAlertEnabled: v })
                }
              >
                启用
              </Switch>
            </CardHeader>
            <CardBody className="gap-4">
              <div className="grid md:grid-cols-3 gap-4">
                <Input
                  type="number"
                  label="阈值（%）"
                  description="超过则触发；如 4 表示 4%"
                  value={(s.errorRateThreshold * 100).toFixed(2)}
                  onValueChange={(v) => {
                    const n = Number(v);
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
                <Input
                  type="number"
                  label="冷却（分钟）"
                  description="同一告警重发的最短间隔"
                  value={String(s.errorRateCooldownMinutes)}
                  onValueChange={(v) =>
                    setS({
                      ...s,
                      errorRateCooldownMinutes: Math.max(
                        0,
                        Math.floor(Number(v) || 0),
                      ),
                    })
                  }
                />
                <div className="flex items-end">
                  <span className="text-xs text-default-500">
                    上次发送：
                    {s.errorRateLastSentAt
                      ? new Date(s.errorRateLastSentAt).toLocaleString("zh-CN")
                      : "—"}
                  </span>
                </div>
              </div>
              <Button color="primary" onPress={save} isLoading={saving}>
                保存
              </Button>
            </CardBody>
          </Card>
        </div>
      )}
    </Shell>
  );
}
