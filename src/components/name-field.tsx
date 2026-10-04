"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useSupper } from "@/components/supper-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeDisplayName } from "@/lib/names";

function NameFieldForm({ saved }: { saved: string }) {
  const { updateMyName } = useSupper();
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = normalizeDisplayName(value);
  const changed = next != null && next !== saved.trim().replace(/\s+/g, " ");

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!next || !changed) return;
        setBusy(true);
        setError(null);
        void updateMyName(next)
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Could not save that name.");
          })
          .finally(() => setBusy(false));
      }}
    >
      <Label htmlFor="name">Your name</Label>
      <Input
        id="name"
        value={value}
        maxLength={40}
        autoComplete="name"
        onChange={(event) => setValue(event.target.value)}
        className="h-12 min-h-12 rounded-[var(--radius-button)] bg-card"
      />
      <p className="type-meta text-muted-foreground">Shown on votes and “Waiting on”.</p>
      {error ? (
        <p className="type-meta text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="fat" variant="primary" className="w-full" disabled={!changed || busy}>
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function NameField() {
  const { session } = useSupper();
  const saved = session?.displayName ?? "";
  return <NameFieldForm key={saved} saved={saved} />;
}
