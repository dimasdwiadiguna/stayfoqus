"use client";

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useCategories } from "@/hooks/use-tasks";
import { toast } from "@/components/ui/toast";
import { createRow, restoreRow, softDeleteRow, updateRow } from "@/lib/db/mutations";
import type { UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

const PALETTE = [
  "#7c9cff",
  "#43c98a",
  "#f0b429",
  "#c084fc",
  "#57c9b6",
  "#f4574d",
  "#9aa2ae",
];

/**
 * §4.1 / §7.5 — categories are user-defined and all four seeds are deletable.
 *
 * Deleting one used to open a confirmation and offer nothing afterwards. It is
 * the other way round now: the delete happens, and the toast carries both the
 * consequence ("tugas yang memakainya jadi tanpa kategori") and the inverse.
 * The delete is soft, so the inverse is exact.
 */
export function CategoryEditor() {
  const categories = useCategories();

  return (
    <Section title={t.settings.sectionCategories}>
      <ul className="space-y-2">
        {categories.map((category) => (
          <li key={category.id} className="flex items-center gap-2">
            <ColorPicker
              value={category.color}
              onChange={(color) => void updateRow("categories", category.id, { color })}
              label={category.name}
            />
            <Input
              defaultValue={category.name}
              aria-label={t.settings.categoryName}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== category.name) {
                  void updateRow("categories", category.id, { name });
                }
              }}
            />
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={`${t.common.delete} ${category.name}`}
              onClick={() => void deleteCategory(category.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        block
        onClick={() =>
          void createRow("categories", {
            name: t.settings.addCategory,
            color: PALETTE[categories.length % PALETTE.length]!,
            icon: "circle",
            sort_order: categories.length,
          })
        }
      >
        <Plus className="size-4" />
        {t.settings.addCategory}
      </Button>

    </Section>
  );
}

/**
 * §4.1 says categories are deletable. Todos keep a dangling `category_id`
 * rather than being rewritten: the grouping layer already treats an unknown
 * category as "Tanpa kategori", and rewriting every todo would be a large
 * cascade for a reversible action.
 */
async function deleteCategory(categoryId: UUID): Promise<void> {
  await softDeleteRow("categories", categoryId);
  toast.undoable(t.settings.deleteCategoryConfirm, () => {
    void restoreRow("categories", categoryId);
  });
}

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const index = Math.max(0, PALETTE.indexOf(value));
  return (
    <button
      type="button"
      aria-label={`${t.settings.categoryColor} ${label}`}
      onClick={() => onChange(PALETTE[(index + 1) % PALETTE.length]!)}
      className="tap-44 size-8 shrink-0 rounded-full border border-border-strong"
      style={{ backgroundColor: value }}
    />
  );
}
