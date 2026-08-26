import type { Metadata } from "next";

import { TasksPageClient } from "@/components/tasks/tasks-page-client";
import { id as t } from "@/lib/i18n/id";

export const metadata: Metadata = { title: t.nav.tasks };

export default function TasksPage() {
  return <TasksPageClient />;
}
