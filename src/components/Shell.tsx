import MobileNav from "./MobileNav";
import Sidebar from "./Sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background relative">
      {/* Soft background glow — subtle, only behind content */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_hsl(var(--primary)/0.08),_transparent_50%),radial-gradient(ellipse_at_bottom_left,_hsl(var(--primary)/0.04),_transparent_50%)]"
      />
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav />
        <div className="flex-1 px-3 sm:px-4 md:px-8 py-4 md:py-6 mx-auto w-full max-w-[1600px]">
          {children}
        </div>
      </div>
    </div>
  );
}
