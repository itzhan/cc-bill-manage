"use client";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
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

// 每日利润柱状图 — 正负分别用 success / danger 染色, 0 轴用 ReferenceLine 强调。
// 给"近一周"小图用 (height 200), 也可被复用做长区间。
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
      <BarChart
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
        />
        <YAxis
          tick={{ fill: "hsl(var(--heroui-default-500))", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => fmtMoneyShort(Number(v), 1)}
        />
        <Tooltip
          cursor={{ fill: "hsla(var(--heroui-foreground)/0.05)" }}
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
        <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {chartData.map((p, i) => (
            <Cell
              key={i}
              fill={
                p.profit >= 0
                  ? "hsl(var(--heroui-success))"
                  : "hsl(var(--heroui-danger))"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
