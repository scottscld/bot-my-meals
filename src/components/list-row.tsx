import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CART_CHIP_LABEL } from "@/lib/list-review";
import { listItemDisplay } from "@/lib/shopping";
import type { ShoppingItem } from "@/lib/types";

export function ListRow({
  item,
  onRemove,
}: {
  item: ShoppingItem;
  onRemove?: () => void;
}) {
  const display = listItemDisplay(item);
  const chip = item.cart ? CART_CHIP_LABEL[item.cart.status] : null;
  return (
    <li data-slot="list-row" className="flex min-h-12 items-center gap-3 px-1 py-2">
      <span className="min-w-0 flex-1">
        <span className="type-body flex flex-wrap items-center gap-2">
          <span>{display.name}</span>
          {item.source === "manual" ? (
            <span className="type-meta rounded-full bg-secondary px-2 py-0.5 text-primary">Added</span>
          ) : null}
        </span>
        {item.note ? <span className="type-meta block text-muted-foreground">{item.note}</span> : null}
      </span>
      <span className="type-meta font-mono text-muted-foreground">{display.quantity}</span>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-12 min-h-12 min-w-12"
          aria-label={`Have ${display.name}, remove`}
          onClick={onRemove}
        >
          <Check className="size-5" />
        </Button>
      ) : chip ? (
        <span className="type-meta shrink-0 rounded-full bg-secondary px-2 py-1 text-foreground">{chip}</span>
      ) : null}
    </li>
  );
}
