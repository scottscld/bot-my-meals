import type { ShoppingItem } from "@/lib/types";

export function ListProblemSections({
  missing,
  substituted,
}: {
  missing: readonly ShoppingItem[];
  substituted: readonly ShoppingItem[];
}) {
  if (missing.length === 0 && substituted.length === 0) return null;
  return (
    <>
      {missing.length > 0 ? (
        <section>
          <h2 className="type-section text-primary">Couldn&apos;t find ({missing.length})</h2>
          <ul className="mt-2 space-y-1">
            {missing.map((item) => (
              <li key={item.id} className="type-body">
                {item.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {substituted.length > 0 ? (
        <section>
          <h2 className="type-section text-primary">Substituted ({substituted.length})</h2>
          <ul className="mt-2 space-y-1">
            {substituted.map((item) => (
              <li key={item.id} className="type-body">
                {item.name} → {item.cart?.product || "a different product"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
