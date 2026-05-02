import Sidebar from "./Sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-default-50/40 dark:bg-background relative">
      {/* Soft background glow — subtle, only behind content */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_hsl(var(--heroui-primary)/0.06),_transparent_60%)]"
      />
      <Sidebar />
      <div className="flex-1 min-w-0 px-4 md:px-8 py-6 mx-auto w-full max-w-[1600px]">
        {children}
      </div>
    </div>
  );
}
