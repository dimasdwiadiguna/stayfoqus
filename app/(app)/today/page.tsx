import type { Metadata } from "next";

import { TodayScreen } from "@/components/today/today-screen";
import { id as t } from "@/lib/i18n/id";

export const metadata: Metadata = { title: t.nav.today };

export default function TodayPage() {
  return <TodayScreen />;
}
