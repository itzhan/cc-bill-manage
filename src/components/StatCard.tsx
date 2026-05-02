import { Card, CardBody, Chip } from "@heroui/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface StatCardProps {
  label: string;
  value: string;
  trend?: { delta: number; suffix?: string };
  hint?: string;
  positiveIsGood?: boolean;
  icon?: LucideIcon;
  /** Accent color for icon halo + subtle background gradient */
  accent?: "primary" | "success" | "danger" | "warning" | "default";
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, {
  iconBg: string;
  iconText: string;
  glow: string;
}> = {
  primary: {
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    glow: "from-primary/5",
  },
  success: {
    iconBg: "bg-success/10",
    iconText: "text-success",
    glow: "from-success/5",
  },
  danger: {
    iconBg: "bg-danger/10",
    iconText: "text-danger",
    glow: "from-danger/5",
  },
  warning: {
    iconBg: "bg-warning/10",
    iconText: "text-warning",
    glow: "from-warning/5",
  },
  default: {
    iconBg: "bg-default-200/50",
    iconText: "text-default-500",
    glow: "from-default-100/40",
  },
};

export default function StatCard({
  label,
  value,
  trend,
  hint,
  positiveIsGood = true,
  icon: Icon,
  accent = "default",
}: StatCardProps) {
  let chipColor: "success" | "danger" | "default" = "default";
  if (trend && trend.delta !== 0) {
    const goingUp = trend.delta > 0;
    const good = positiveIsGood ? goingUp : !goingUp;
    chipColor = good ? "success" : "danger";
  }
  const a = accentClasses[accent];
  return (
    <Card className="bg-content1 border border-divider/40 shadow-none rounded-2xl overflow-hidden relative">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.glow} to-transparent opacity-60`}
      />
      <CardBody className="p-5 gap-3 relative">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {Icon && (
              <div
                className={`w-8 h-8 rounded-lg ${a.iconBg} ${a.iconText} flex items-center justify-center`}
              >
                <Icon size={16} />
              </div>
            )}
            <p className="text-sm text-default-500">{label}</p>
          </div>
          {trend && trend.delta !== 0 && (
            <Chip
              size="sm"
              color={chipColor}
              variant="flat"
              radius="md"
              startContent={
                trend.delta > 0 ? (
                  <ArrowUp size={11} />
                ) : (
                  <ArrowDown size={11} />
                )
              }
              classNames={{ content: "text-xs font-medium px-0.5" }}
            >
              {Math.abs(trend.delta).toFixed(1)}
              {trend.suffix ?? "%"}
            </Chip>
          )}
        </div>
        <p className="text-3xl font-bold tracking-tight leading-none">
          {value}
        </p>
        {hint && (
          <p className="text-xs text-default-400 truncate">{hint}</p>
        )}
      </CardBody>
    </Card>
  );
}
