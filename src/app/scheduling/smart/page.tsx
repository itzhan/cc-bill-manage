"use client";
import { Suspense, useMemo } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import SmartDispatchPanel from "@/components/SmartDispatchPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SmartDispatchPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </Shell>
      }
    >
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
          <CardContent className="py-4 text-destructive text-sm">
            缺少 siteId 或 groupId / groupIds 参数
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/scheduling">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">智能调度</h1>
        <Badge variant="secondary">
          {groupIds.length === 1 ? "单分组" : `${groupIds.length} 个分组`}
        </Badge>
      </div>

      <SmartDispatchPanel siteId={siteId} groupIds={groupIds} />
    </Shell>
  );
}
