import { TabBar } from "@/components/shell/tab-bar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col">
      {children}
      <TabBar />
    </div>
  );
}
