"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoneyShort } from "@/lib/format";

export interface ExpenseBarPoint {
  label: string;
  cost: number;
  group?: string;
  multiplier?: number;
}

export default function ExpenseBarChart({ data }: { data: ExpenseBarPoint[] }) {
  if (!data.length) {
    return (
      <div className="h-72 flex items-center justify-center text-default-400 text-sm">
        暂无支出数据
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={288}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--heroui-divider))" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "hsl(var(--heroui-default-500))", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--heroui-divider))" }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={50}
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
          formatter={((v: unknown, _n: unknown, item: { payload?: ExpenseBarPoint }) => {
            const num = typeof v === "number" ? v : Number(v) || 0;
            const p = item?.payload;
            const parts = [`花费 ${fmtMoneyShort(num)}`];
            if (p?.group) parts.push(`${p.group} ×${p.multiplier ?? 1}`);
            return [parts.join(" · "), ""] as [string, string];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any}
        />
        <Bar
          dataKey="cost"
          fill="hsl(var(--heroui-primary))"
          radius={[6, 6, 0, 0]}
          maxBarSize={48}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

