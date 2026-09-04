"use client";

import { CalendarCheck, CalendarDays, CheckSquare, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

import { id as t } from "@/lib/i18n/id";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/tasks", label: t.nav.tasks, Icon: CheckSquare },
  { href: "/calendar", label: t.nav.calendar, Icon: CalendarDays },
  { href: "/today", label: t.nav.today, Icon: CalendarCheck },
  { href: "/settings", label: t.nav.settings, Icon: Settings },
] as const satisfies ReadonlyArray<{ href: Route; label: string; Icon: unknown }>;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label={t.app.name}
      className="safe-bottom shrink-0 border-t border-border bg-surface/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-accent" : "text-fg-subtle hover:text-fg-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
