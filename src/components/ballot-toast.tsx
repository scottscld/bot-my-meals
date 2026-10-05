"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function BallotToast({
  message,
  onDismiss,
  alert = false,
  action,
  duration = 3200,
}: {
  message?: string;
  onDismiss: () => void;
  alert?: boolean;
  action?: { label: string; onClick: () => void };
  duration?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, duration, action?.label]);

  if (!message) return null;

  return (
    <div
      data-slot="ballot-toast"
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      className={cn(
        "fixed inset-x-4 z-40 mx-auto max-w-lg rounded-[14px] bg-card px-4 py-3 shadow-float",
        "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
      )}
    >
      <p className="type-body text-foreground">
        {message}
        {action ? (
          <>
            {" · "}
            <button type="button" className="font-semibold text-primary" onClick={action.onClick}>
              {action.label}
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
