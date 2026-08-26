import { FocusLayer } from "@/components/focus/focus-layer";
import { TabBar } from "@/components/shell/tab-bar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col">
      {children}
      {/* §7.4: Fokus is an overlay over every tab, never a tab of its own. */}
      <FocusLayer />
      <TabBar />
    </div>
  );
}
