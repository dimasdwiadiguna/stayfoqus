import type { Metadata } from "next";

import { SettingsScreen } from "@/components/settings/settings-screen";
import { id as t } from "@/lib/i18n/id";

export const metadata: Metadata = { title: t.nav.settings };

export default function SettingsPage() {
  return <SettingsScreen />;
}
