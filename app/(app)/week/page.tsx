import type { Metadata } from "next";

import { WeekScreen } from "@/components/week/week-screen";
import { id as t } from "@/lib/i18n/id";

export const metadata: Metadata = { title: t.nav.week };

export default function WeekPage() {
  return <WeekScreen />;
}
