"use client";

import { memberName } from "@/lib/names";
import { listItemDisplay } from "@/lib/shopping";
import type { Membership, ShoppingItem } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function ListRemovedSection({
  items,
  memberships,
  canEdit,
  onRestore,
}: {
  items: readonly ShoppingItem[];
  memberships: readonly Membership[];
  canEdit: boolean;
  onRestore: (itemId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <details data-slot="list-removed" className="rounded-[14px] border border-border bg-card px-4 py-3">
      <summary className="type-section cursor-pointer text-primary">Removed ({items.length})</summary>
      <ul className="mt-3 divide-y divide-border">
        {items.map((item) => {
          const display = listItemDisplay(item);
          const who = memberships.find((member) => member.id === item.removedBy);
          return (
            <li key={item.id} className="flex min-h-12 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="type-body block text-muted-foreground">{display.name}</span>
                <span className="type-meta text-muted-foreground">
                  {display.quantity}
                  {who ? ` · by ${memberName(who)}` : ""}
                </span>
              </span>
              {canEdit ? (
                <Button type="button" variant="outline" size="fat" onClick={() => onRestore(item.id)}>
                  Put back
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
