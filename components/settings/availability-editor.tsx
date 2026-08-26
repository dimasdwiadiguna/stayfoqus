"use client";

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Row, Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/field";
import { useAvailabilityWindows } from "@/hooks/use-scheduling";
import { createRow, softDeleteRow, updateRow } from "@/lib/db/mutations";
import type { AvailabilityWindow, DayOfWeek } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { minutesFromMidnight } from "@/lib/time";
import { cn } from "@/lib/utils";

const DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * §4.5 / §5.1 — the availability window editor.
 * Multiple windows per day are allowed; overlaps and inverted ranges are
 * flagged inline rather than rejected, so the user is never stuck mid-edit.
 */
export function AvailabilityEditor() {
  const windows = useAvailabilityWindows();

  const byDay = React.useMemo(() => {
    const map = new Map<DayOfWeek, AvailabilityWindow[]>();
    for (const day of DAYS) map.set(day, []);
    for (const w of windows) map.get(w.day_of_week)?.push(w);
    for (const list of map.values()) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [windows]);

  return (
    <Section title={t.settings.sectionAvailability} blurb={t.settings.availabilityBlurb}>
      {DAYS.map((day) => {
        const list = byDay.get(day) ?? [];
        return (
          <div key={day} className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium">{t.days.long[day]}</span>
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={t.settings.addWindow}
                onClick={() =>
                  void createRow("availability_windows", {
                    day_of_week: day,
                    start_time: "09:00",
                    end_time: "17:00",
                    enabled: true,
                  })
                }
              >
                <Plus className="size-4" />
              </Button>
            </div>

            {list.length === 0 ? (
              <p className="mt-2 text-[12px] text-fg-subtle">{t.common.none}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {list.map((w, index) => {
                  const invalid =
                    minutesFromMidnight(w.end_time) <= minutesFromMidnight(w.start_time);
                  const previous = list[index - 1];
                  const overlaps =
                    previous !== undefined && w.start_time < previous.end_time;

                  return (
                    <li key={w.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          step={300}
                          value={w.start_time}
                          aria-label={t.agenda.fieldStart}
                          onChange={(e) =>
                            void updateRow("availability_windows", w.id, {
                              start_time: e.target.value,
                            })
                          }
                          className="h-10 flex-1"
                        />
                        <span className="text-fg-subtle">–</span>
                        <Input
                          type="time"
                          step={300}
                          value={w.end_time}
                          aria-label={t.agenda.fieldEnd}
                          onChange={(e) =>
                            void updateRow("availability_windows", w.id, {
                              end_time: e.target.value,
                            })
                          }
                          className="h-10 flex-1"
                        />
                        <Switch
                          checked={w.enabled}
                          aria-label={w.start_time}
                          onCheckedChange={(on) =>
                            void updateRow("availability_windows", w.id, {
                              enabled: on,
                            })
                          }
                        />
                        <Button
                          size="iconSm"
                          variant="ghost"
                          aria-label={t.common.delete}
                          onClick={() => void softDeleteRow("availability_windows", w.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      {invalid || overlaps ? (
                        <p
                          className={cn(
                            "text-[11px]",
                            invalid ? "text-danger" : "text-warning",
                          )}
                        >
                          {invalid ? t.settings.windowInvalid : t.settings.windowOverlap}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </Section>
  );
}

export { Row };
