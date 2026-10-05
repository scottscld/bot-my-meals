"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ManualItemDraft, Store } from "@/lib/types";

const UNIT_SUGGESTIONS = ["ea", "lb", "oz", "pack", "can", "bunch"];

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function ListAddItemSheet({
  stores,
  busy,
  onAdd,
}: {
  stores: readonly Store[];
  busy: boolean;
  onAdd: (draft: ManualItemDraft) => Promise<void>;
}) {
  const ordered = [...stores].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [storeId, setStoreId] = useState(ordered[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const cleaned = cleanName(name);
    const qty = Number(quantity);
    const trimmedUnit = unit.trim();
    const trimmedNote = note.trim();
    if (!cleaned || cleaned.length > 80) {
      setError("Item name must be 1–80 characters.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999) {
      setError("Quantity must be between 0 and 999.");
      return;
    }
    if (trimmedUnit.length > 20 || trimmedNote.length > 140) {
      setError("Unit or note is too long.");
      return;
    }
    if (ordered.length === 0) {
      setError("Add a store in House first.");
      return;
    }
    setError(null);
    const draft: ManualItemDraft = {
      name: cleaned,
      quantity: Math.round(qty * 100) / 100,
      unit: trimmedUnit,
      note: trimmedNote || null,
      storeId: ordered.length > 1 ? storeId || ordered[0]?.id || null : ordered[0]?.id ?? null,
    };
    void onAdd(draft)
      .then(() => {
        setName("");
        setNote("");
      })
      .catch(() => undefined);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="fat" className="w-full" data-slot="list-add-item">
          + Add item
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-[16px] px-4">
        <SheetHeader>
          <SheetTitle className="type-section">Add item</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-1">
          <div className="space-y-1">
            <Label htmlFor="list-add-name">Name</Label>
            <Input
              id="list-add-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              className="h-12 min-h-12 text-base"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="list-add-qty">Qty</Label>
              <Input
                id="list-add-qty"
                type="number"
                inputMode="decimal"
                min={0.25}
                max={999}
                step={0.25}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="h-12 min-h-12 text-base"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="list-add-unit">Unit</Label>
              <Input
                id="list-add-unit"
                list="list-add-units"
                value={unit}
                maxLength={20}
                onChange={(event) => setUnit(event.target.value)}
                className="h-12 min-h-12 text-base"
              />
              <datalist id="list-add-units">
                {UNIT_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="list-add-note">Note</Label>
            <Input
              id="list-add-note"
              value={note}
              maxLength={140}
              onChange={(event) => setNote(event.target.value)}
              className="h-12 min-h-12 text-base"
            />
          </div>
          {ordered.length > 1 ? (
            <div className="space-y-1">
              <Label htmlFor="list-add-store">Store</Label>
              <select
                id="list-add-store"
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className="h-12 min-h-12 w-full rounded-[var(--radius-button)] border border-border bg-card px-3 text-base"
              >
                {ordered.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {error ? <p className="type-meta text-destructive">{error}</p> : null}
        </div>
        <SheetFooter>
          <Button type="button" size="fat" variant="primary" className="w-full" disabled={busy} onClick={submit}>
            Add
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
