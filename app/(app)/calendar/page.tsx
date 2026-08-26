import type { Metadata } from "next";

import { CalendarScreen } from "@/components/calendar/calendar-screen";
import { id as t } from "@/lib/i18n/id";

export const metadata: Metadata = { title: t.nav.calendar };

export default function CalendarPage() {
  return <CalendarScreen />;
}
