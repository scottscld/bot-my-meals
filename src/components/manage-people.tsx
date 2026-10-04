"use client";

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { HouseCard } from "@/components/house-card";
import { useSupper } from "@/components/supper-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Role } from "@/lib/types";
import { memberName, normalizeDisplayName } from "@/lib/names";
import type { Membership } from "@/lib/types";
import { isAdmin, roleLabel } from "@/lib/users";

function MemberName({ member, you }: { member: Membership; you: boolean }) {
  const { updateMemberName } = useSupper();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = normalizeDisplayName(value);

  if (!editing) {
    return (
      <div>
        <p className="type-body font-medium">
          {memberName(member)}
          {you ? <span className="text-muted-foreground"> · you</span> : null}
          <button
            type="button"
            className="ml-2 inline-flex size-7 items-center justify-center rounded-full text-primary"
            aria-label={`Edit name for ${memberName(member)}`}
            onClick={() => {
              setValue(member.displayName);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        </p>
        <p className="type-meta text-muted-foreground">{member.email}</p>
      </div>
    );
  }

  return (
    <form
      className="min-w-0 flex-1 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!next) {
          setError("Name must be 1–40 characters.");
          return;
        }
        setBusy(true);
        setError(null);
        void updateMemberName(member.id, next)
          .then(() => setEditing(false))
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Could not save that name.");
          })
          .finally(() => setBusy(false));
      }}
    >
      <Label htmlFor={`member-name-${member.id}`}>Name</Label>
      <Input
        id={`member-name-${member.id}`}
        value={value}
        maxLength={40}
        autoComplete="name"
        onChange={(event) => setValue(event.target.value)}
        className="h-12 min-h-12 rounded-[var(--radius-button)] bg-card"
      />
      {error ? (
        <p className="type-meta text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="fat" variant="primary" className="flex-1" disabled={!next || busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="fat" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ManagePeople() {
  const {
    snapshot,
    session,
    addMember,
    updateMemberRole,
    removeMember,
    removeInvite,
  } = useSupper();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("voter");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!snapshot || !isAdmin(session?.role)) return null;

  const pending = snapshot.pendingInvites ?? [];

  return (
    <HouseCard className="mt-6">
      <h2 className="type-section text-primary">People</h2>
      <p className="type-meta mt-1 text-muted-foreground">
        Admins manage the house. Users can swap or remove a night — no tap leaves the dinner as-is. Add
        someone by name and email, or share the invite link above. They sign in with an email code.
      </p>

      <ul className="mt-4 space-y-3">
        {snapshot.memberships.map((member) => {
          const current = member.id === session?.membershipId;
          return (
            <li
              key={member.id}
              data-slot="member-row"
              className="rounded-[14px] bg-secondary px-4 py-3"
            >
              <div className="flex min-h-12 items-start justify-between gap-3">
                <MemberName
                  member={member}
                  you={current}
                />
                <Badge variant="outline">{roleLabel(member.role)}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="fat"
                  variant={member.role === "owner" ? "default" : "outline"}
                  onClick={() => void updateMemberRole(member.id, "owner")}
                >
                  Admin
                </Button>
                <Button
                  type="button"
                  size="fat"
                  variant={member.role === "voter" ? "default" : "outline"}
                  onClick={() => void updateMemberRole(member.id, "voter")}
                >
                  User
                </Button>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="fat"
                  className="flex-1 text-destructive"
                  disabled={removingId === member.id}
                  aria-busy={removingId === member.id}
                  onClick={() => {
                    setRemovingId(member.id);
                    void removeMember(member.id)
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : "Could not remove that person.");
                      })
                      .finally(() => setRemovingId(null));
                  }}
                >
                  {removingId === member.id ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
                  {removingId === member.id ? "Removing…" : "Remove"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {pending.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="type-body font-medium">Waiting to sign in</p>
          {pending.map((invite) => (
            <div
              key={invite.id}
              className="flex min-h-12 items-center justify-between gap-3 rounded-[14px] bg-secondary px-4 py-3"
            >
              <div>
                <p className="type-body font-medium">{invite.displayName}</p>
                <p className="type-meta text-muted-foreground">
                  {invite.email} · {roleLabel(invite.role)} · not signed in yet
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="fat"
                className="shrink-0 text-destructive"
                disabled={removingId === invite.id}
                aria-busy={removingId === invite.id}
                onClick={() => {
                  setRemovingId(invite.id);
                  void removeInvite(invite.id)
                    .catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "Could not remove that invite.");
                    })
                    .finally(() => setRemovingId(null));
                }}
              >
                {removingId === invite.id ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
                {removingId === invite.id ? "Removing…" : "Remove"}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <form
        className="mt-5 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await addMember({ displayName, email, role });
            setDisplayName("");
            setEmail("");
            setRole("voter");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not add that person.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="type-body font-medium">Add a person</p>
        <div className="space-y-1.5">
          <Label htmlFor="new-member-name">Name</Label>
          <p id="new-member-name-hint" className="type-meta text-muted-foreground">
            e.g. Jordan
          </p>
          <Input
            id="new-member-name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="h-12 min-h-12 rounded-[var(--radius-button)] bg-card"
            autoComplete="name"
            aria-describedby="new-member-name-hint"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-member-email">Email</Label>
          <p id="new-member-email-hint" className="type-meta text-muted-foreground">
            e.g. jordan@example.com
          </p>
          <Input
            id="new-member-email"
            type="email"
            required
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 min-h-12 rounded-[var(--radius-button)] bg-card"
            autoComplete="email"
            aria-describedby="new-member-email-hint"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="fat"
            variant={role === "owner" ? "default" : "outline"}
            onClick={() => setRole("owner")}
          >
            Admin
          </Button>
          <Button
            type="button"
            size="fat"
            variant={role === "voter" ? "default" : "outline"}
            onClick={() => setRole("voter")}
          >
            User
          </Button>
        </div>
        <Button size="fat" className="w-full" disabled={busy}>
          {busy ? "Adding…" : "Save invite"}
        </Button>
        <p className="type-meta text-muted-foreground">
          They sign in themselves with a code in the app. The share link above is the easy path. Bot My
          Meals does not email the invite from here.
        </p>
        {error ? <p className="type-meta text-destructive">{error}</p> : null}
      </form>
    </HouseCard>
  );
}
