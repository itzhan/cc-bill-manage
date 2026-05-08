"use client";
import { Suspense, useMemo } from "react";
import { Button, Card, CardBody, Chip, Spinner } from "@heroui/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import SmartDispatchPanel from "@/components/SmartDispatchPanel";

// Deep-link fallback. The primary entry is now the modal on /scheduling
// (per-group card or custom-group card → 智能调度 button → modal).
// This page still renders so that bookmarked URLs continue to work, but it
// doesn't try to thread the parent page's "exclude prefixes" filter — the
// modal does that.
export default function SmartDispatchPage() {
  return (
    <Suspense fallback={<Shell><Spinner /></Shell>}>
      <SmartDispatchInner />
    </Suspense>
  );
}

function SmartDispatchInner() {
  const search = useSearchParams();
  const siteId = Number(search.get("siteId") || "");
  const groupId = Number(search.get("groupId") || "");
  const groupIdsCsv = search.get("groupIds");
  const groupIds = useMemo(() => {
    const set = new Set<number>();
    if (groupId) set.add(groupId);
    if (groupIdsCsv) {
      for (const s of groupIdsCsv.split(",")) {
        const n = Number(s.trim());
        if (Number.isFinite(n) && n > 0) set.add(n);
      }
    }
    return [...set];
  }, [groupId, groupIdsCsv]);

  if (!siteId || groupIds.length === 0) {
    return (
      <Shell>
        <Card>
          <CardBody className="text-danger text-sm">
            缺少 siteId 或 groupId / groupIds 参数
          </CardBody>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button
          as={Link}
          href="/scheduling"
          size="sm"
          variant="light"
          startContent={<ArrowLeft size={14} />}
        >
          返回
        </Button>
        <h1 className="text-xl font-semibold">智能调度</h1>
        <Chip size="sm" variant="flat">
          {groupIds.length === 1 ? "单分组" : `${groupIds.length} 个分组`}
        </Chip>
      </div>

      <SmartDispatchPanel siteId={siteId} groupIds={groupIds} />
    </Shell>
  );
}
