"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoneyShort } from "@/lib/format";

export interface DailyProfitPoint {
  date: string;
  profit: number;
}

// 每日利润折线图 — 蓝色 (primary); 0 轴用 ReferenceLine 标出, 方便看正负。
export default function DailyProfitChart({
  data,
  height = 220,
}: {
  data: DailyProfitPoint[];
  height?: number;
}) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-default-400 text-sm"
        style={{ height }}
      >
        暂无利润数据
      </div>
    );
  }
  // chronological (left = oldest)
  const chartData = [...data].reverse().map((p) => ({
    label: p.date.slice(5),
    profit: p.profit,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={chartData}
        margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
      >
        <CartesianGrid
          stroke="hsl(var(--heroui-divider))"
          strokeDasharray="3 3"
          vertical={false}
        />
        <ReferenceLine y={0} stroke="hsl(var(--heroui-divider))" />
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
          formatter={
            ((v: unknown) => {
              const n = typeof v === "number" ? v : Number(v) || 0;
              return [fmtMoneyShort(n), n >= 0 ? "盈利" : "亏损"] as [
                string,
                string,
              ];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any
          }
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke="hsl(var(--heroui-primary))"
          strokeWidth={2}
          dot={{ r: 3, fill: "hsl(var(--heroui-primary))" }}
          name="日利润"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
