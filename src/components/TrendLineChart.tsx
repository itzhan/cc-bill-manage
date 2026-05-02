"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoneyShort } from "@/lib/format";

export interface TrendPoint {
  t: string;
  revenue: number;
  expense: number;
  profit: number;
}

export default function TrendLineChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) {
    return (
      <div className="h-72 flex items-center justify-center text-default-400 text-sm">
        暂无历史快照（同步几次后会有趋势）
      </div>
    );
  }
  const chartData = data.map((p) => ({
    ...p,
    label: new Date(p.t).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  return (
    <ResponsiveContainer width="100%" height={288}>
      <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--heroui-divider))" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "hsl(var(--heroui-default-500))", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--heroui-divider))" }}
          minTickGap={32}
        />
        <YAxis
          tick={{ fill: "hsl(var(--heroui-default-500))", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => fmtMoneyShort(Number(v), 1)}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--heroui-content2))",
            border: "1px solid hsl(var(--heroui-divider))",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "hsl(var(--heroui-foreground))" }}
          formatter={((v: unknown) => {
            const n = typeof v === "number" ? v : Number(v) || 0;
            return fmtMoneyShort(n);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="hsl(var(--heroui-success))"
          strokeWidth={2}
          dot={false}
          name="收入"
        />
        <Line
          type="monotone"
          dataKey="expense"
          stroke="hsl(var(--heroui-danger))"
          strokeWidth={2}
          dot={false}
          name="支出"
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke="hsl(var(--heroui-primary))"
          strokeWidth={2}
          dot={false}
          name="利润"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
