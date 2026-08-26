"use client";

import * as React from "react";

import { ScheduleSheet } from "@/components/calendar/schedule-sheet";
import { TasksScreen } from "@/components/tasks/tasks-screen";
import type { Todo } from "@/lib/db/schema";

/**
 * §8: drag and drop never crosses screens, so converting a todo into an agenda
 * goes through an explicit sheet that both the swipe menu and the detail sheet
 * open. It lives here, above the list, so it survives the list re-rendering.
 */
export function TasksPageClient() {
  const [scheduling, setScheduling] = React.useState<Todo | null>(null);

  return (
    <>
      <TasksScreen onScheduleTodo={setScheduling} />
      <ScheduleSheet todo={scheduling} onClose={() => setScheduling(null)} />
    </>
  );
}
