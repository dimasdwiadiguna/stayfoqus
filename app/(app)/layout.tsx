import { FocusLayer } from "@/components/focus/focus-layer";
import { RewardLayer } from "@/components/reward/reward-layer";
import { NowTicker } from "@/components/shell/now-ticker";
import { TabBar } from "@/components/shell/tab-bar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The top safe-area inset is applied here rather than on each screen's
    // header: whatever is first inside the shell — the ticker, or a header when
    // the ticker has nothing to say — must clear the notch exactly once.
    <div className="safe-top flex h-dvh flex-col">
      {/* Above every screen, so "what now, what next" is never a tab away. */}
      <NowTicker />
      {children}
      {/* §7.4: Fokus is an overlay over every tab, never a tab of its own. */}
      <FocusLayer />
      {/* §5.9 coupling prompt and the §9 "Hari Selesai" screen. */}
      <RewardLayer />
      <TabBar />
    </div>
  );
}
