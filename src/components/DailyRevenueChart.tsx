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

export interface DailyRevenuePoint {
  date: string;
  revenue: number;
}

// Single-series daily revenue line. Used on dashboard "收入" view.
export default function DailyRevenueChart({
  data,
}: {
  data: DailyRevenuePoint[];
}) {
  if (!data.length) {
    return (
      <div className="h-72 flex items-center justify-center text-default-400 text-sm">
        暂无每日数据（同步后会写入当天的累计值）
      </div>
    );
  }
  // chronological (left = oldest)
  const chartData = [...data].reverse().map((p) => ({
    label: p.date.slice(5), // MM-DD
    revenue: p.revenue,
  }));
  return (
    <ResponsiveContainer width="100%" height={288}>
      <LineChart
        data={chartData}
        margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
      >
        <CartesianGrid
          stroke="hsl(var(--heroui-divider))"
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: "hsl(var(--heroui-default-500))", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--heroui-divider))" }}
          minTickGap={24}
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
          dot={{ r: 3, fill: "hsl(var(--heroui-success))" }}
          name="日收入"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
