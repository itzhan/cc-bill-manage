"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tabs,
  Textarea,
  addToast,
  useDisclosure,
} from "@heroui/react";
import {
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Briefcase,
  HandshakeIcon,
} from "lucide-react";
import Shell from "@/components/Shell";
import TopBar from "@/components/TopBar";

type ProjectType = "customer" | "upstream";
type ProjectStatus = "discussing" | "pending_test" | "tested";

interface Project {
  id: number;
  type: ProjectType;
  partnerName: string;
  status: ProjectStatus;
  goal: string;
  siteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseGoals(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function GoalList({ goal }: { goal: string }) {
  const items = parseGoals(goal);
  if (items.length === 0) {
    return <span className="text-default-400">—</span>;
  }
  return (
    <ol className="flex flex-col gap-1.5 max-w-[420px]">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold tabular-nums leading-none">
            {i + 1}
          </span>
          <span className="break-words leading-5">{t}</span>
        </li>
      ))}
    </ol>
  );
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  discussing: "商议中",
  pending_test: "已敲定待测试",
  tested: "已测试",
};

const STATUS_COLOR: Record<ProjectStatus, "default" | "warning" | "success"> = {
  discussing: "default",
  pending_test: "warning",
  tested: "success",
};

const STATUS_ORDER: ProjectStatus[] = ["discussing", "pending_test", "tested"];

const TYPE_LABEL: Record<ProjectType, string> = {
  customer: "企业合作",
  upstream: "渠道商合作",
};

function hostOf(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.host;
  } catch {
    return url;
  }
}

function normalizedHref(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export default function ProjectsPage() {
  const [tab, setTab] = useState<ProjectType>("customer");
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/projects", { cache: "no-store" });
      const j = await r.json();
      setItems((j.items || []) as Project[]);
    } catch (e) {
      addToast({ title: "加载失败", description: String(e), color: "danger" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => items.filter((it) => it.type === tab),
    [items, tab],
  );

  function openCreate() {
    setEditing(null);
    onOpen();
  }
  function openEdit(it: Project) {
    setEditing(it);
    onOpen();
  }

  async function changeStatus(id: number, status: ProjectStatus) {
    try {
      const r = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      await load();
    } catch (e) {
      addToast({ title: "更新失败", description: String(e), color: "danger" });
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`删除「${name}」? 此操作不可恢复`)) return;
    try {
      const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      addToast({ title: "已删除", color: "success" });
      await load();
    } catch (e) {
      addToast({ title: "删除失败", description: String(e), color: "danger" });
    }
  }

  return (
    <Shell>
      <TopBar
        title="项目跟踪"
        subtitle="手工维护合作进度。企业 = 客户跑我们 API；渠道商 = 我们跑对方 API"
        actions={
          <Button
            color="primary"
            radius="full"
            startContent={<Plus size={14} />}
            onPress={openCreate}
          >
            新增
          </Button>
        }
      />

      <Tabs
        aria-label="project type"
        radius="full"
        color="default"
        variant="solid"
        selectedKey={tab}
        onSelectionChange={(k) => setTab(k as ProjectType)}
        classNames={{
          tabList: "bg-content2 p-1 mb-4",
          cursor: "bg-content1 shadow-sm",
          tab: "px-4 h-9",
        }}
      >
        <Tab
          key="customer"
          title={
            <span className="flex items-center gap-1.5">
              <Briefcase size={14} />
              企业合作
            </span>
          }
        />
        <Tab
          key="upstream"
          title={
            <span className="flex items-center gap-1.5">
              <HandshakeIcon size={14} />
              渠道商合作
            </span>
          }
        />
      </Tabs>

      <Card className="bg-content1 border border-divider/50 shadow-none">
        <CardHeader className="flex justify-between items-center pb-2">
          <div>
            <h2 className="font-semibold">{TYPE_LABEL[tab]}</h2>
            <p className="text-xs text-default-500 mt-0.5">共 {filtered.length} 个</p>
          </div>
        </CardHeader>
        <CardBody>
          {loading && items.length === 0 ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-default-500 text-sm py-4">
              暂无{TYPE_LABEL[tab]}记录。点右上角「新增」开始
            </p>
          ) : (
            <ProjectsTable
              tab={tab}
              rows={filtered}
              onEdit={openEdit}
              onDelete={remove}
              onChangeStatus={changeStatus}
            />
          )}
        </CardBody>
      </Card>

      <ProjectModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onClose={onClose}
        defaultType={tab}
        initial={editing}
        onSaved={load}
      />
    </Shell>
  );
}

function StatusChip({
  status,
  onChange,
}: {
  status: ProjectStatus;
  onChange: (s: ProjectStatus) => void;
}) {
  return (
    <Dropdown>
      <DropdownTrigger>
        <Chip
          size="sm"
          variant="flat"
          color={STATUS_COLOR[status]}
          className="cursor-pointer"
        >
          {STATUS_LABEL[status]}
        </Chip>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="status"
        selectedKeys={new Set([status])}
        selectionMode="single"
        onAction={(k) => onChange(String(k) as ProjectStatus)}
      >
        {STATUS_ORDER.map((s) => (
          <DropdownItem key={s}>{STATUS_LABEL[s]}</DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        isIconOnly
        size="sm"
        variant="light"
        aria-label="edit"
        onPress={onEdit}
      >
        <Pencil size={14} />
      </Button>
      <Button
        isIconOnly
        size="sm"
        variant="light"
        color="danger"
        aria-label="delete"
        onPress={onDelete}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

function ProjectsTable({
  tab,
  rows,
  onEdit,
  onDelete,
  onChangeStatus,
}: {
  tab: ProjectType;
  rows: Project[];
  onEdit: (it: Project) => void;
  onDelete: (id: number, name: string) => void;
  onChangeStatus: (id: number, s: ProjectStatus) => void;
}) {
  if (tab === "upstream") {
    return (
      <Table aria-label="upstream-projects" removeWrapper>
        <TableHeader>
          <TableColumn>合作方</TableColumn>
          <TableColumn>站点</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>本次商谈目标</TableColumn>
          <TableColumn align="end">操作</TableColumn>
        </TableHeader>
        <TableBody>
          {rows.map((it) => (
            <TableRow key={it.id} className="align-top">
              <TableCell>
                <span className="font-medium">{it.partnerName}</span>
              </TableCell>
              <TableCell>
                {it.siteUrl ? (
                  <a
                    href={normalizedHref(it.siteUrl)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary inline-flex items-center gap-1 hover:underline"
                    title={it.siteUrl}
                  >
                    <span className="truncate max-w-[200px]">
                      {hostOf(it.siteUrl)}
                    </span>
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="text-default-400 text-xs">—</span>
                )}
              </TableCell>
              <TableCell>
                <StatusChip
                  status={it.status}
                  onChange={(s) => onChangeStatus(it.id, s)}
                />
              </TableCell>
              <TableCell>
                <GoalList goal={it.goal} />
              </TableCell>
              <TableCell className="text-right">
                <RowActions
                  onEdit={() => onEdit(it)}
                  onDelete={() => onDelete(it.id, it.partnerName)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Table aria-label="customer-projects" removeWrapper>
      <TableHeader>
        <TableColumn>合作方</TableColumn>
        <TableColumn>状态</TableColumn>
        <TableColumn>本次商谈目标</TableColumn>
        <TableColumn align="end">操作</TableColumn>
      </TableHeader>
      <TableBody>
        {rows.map((it) => (
          <TableRow key={it.id} className="align-top">
            <TableCell>
              <span className="font-medium">{it.partnerName}</span>
            </TableCell>
            <TableCell>
              <StatusChip
                status={it.status}
                onChange={(s) => onChangeStatus(it.id, s)}
              />
            </TableCell>
            <TableCell>
              <GoalList goal={it.goal} />
            </TableCell>
            <TableCell className="text-right">
              <RowActions
                onEdit={() => onEdit(it)}
                onDelete={() => onDelete(it.id, it.partnerName)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProjectModal({
  isOpen,
  onOpenChange,
  onClose,
  defaultType,
  initial,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  onClose: () => void;
  defaultType: ProjectType;
  initial: Project | null;
  onSaved: () => void;
}) {
  const [type, setType] = useState<ProjectType>(defaultType);
  const [partnerName, setPartnerName] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("discussing");
  const [goal, setGoal] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // sync form with `initial` when modal opens; reset to defaults for create
  useEffect(() => {
    if (!isOpen) return;
    if (initial) {
      setType(initial.type);
      setPartnerName(initial.partnerName);
      setStatus(initial.status);
      setGoal(initial.goal);
      setSiteUrl(initial.siteUrl ?? "");
    } else {
      setType(defaultType);
      setPartnerName("");
      setStatus("discussing");
      setGoal("");
      setSiteUrl("");
    }
  }, [isOpen, initial, defaultType]);

  async function save() {
    if (!partnerName.trim()) {
      addToast({ title: "请填写合作方名称", color: "warning" });
      return;
    }
    setSaving(true);
    try {
      const url = initial ? `/api/projects/${initial.id}` : "/api/projects";
      const method = initial ? "PATCH" : "POST";
      const payload = initial
        ? { partnerName, status, goal, siteUrl }
        : { type, partnerName, status, goal, siteUrl };
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      addToast({ title: initial ? "已更新" : "已创建", color: "success" });
      onSaved();
      onClose();
    } catch (e) {
      addToast({ title: "保存失败", description: String(e), color: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              {initial ? `编辑 · ${initial.partnerName}` : "新增项目"}
            </ModalHeader>
            <ModalBody className="gap-4">
              {!initial && (
                <Tabs
                  aria-label="type"
                  radius="full"
                  selectedKey={type}
                  onSelectionChange={(k) => setType(k as ProjectType)}
                >
                  <Tab key="customer" title="企业合作（客户跑我们 API）" />
                  <Tab key="upstream" title="渠道商合作（我们跑对方 API）" />
                </Tabs>
              )}
              <Input
                label="合作方名称"
                value={partnerName}
                onValueChange={setPartnerName}
                isRequired
              />
              {type === "upstream" && (
                <Input
                  label="站点 URL"
                  placeholder="https://example.com"
                  value={siteUrl}
                  onValueChange={setSiteUrl}
                  description="表内会显示域名 + 跳转图标"
                />
              )}
              <Tabs
                aria-label="status"
                radius="full"
                size="sm"
                color={STATUS_COLOR[status]}
                selectedKey={status}
                onSelectionChange={(k) => setStatus(k as ProjectStatus)}
              >
                {STATUS_ORDER.map((s) => (
                  <Tab key={s} title={STATUS_LABEL[s]} />
                ))}
              </Tabs>
              <Textarea
                label="本次商谈目标"
                description="每行一条，会自动渲染成 1 / 2 / 3 编号列表"
                placeholder={"接入 Claude 代理\n月跑量 ≥ 1k\n联调对账接口"}
                value={goal}
                onValueChange={setGoal}
                minRows={4}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={close}>
                取消
              </Button>
              <Button color="primary" onPress={save} isLoading={saving}>
                保存
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
