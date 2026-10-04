"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { servingsLabel } from "@/lib/headcount";
import type { MealOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const SWIPE_SLOP_PX = 10;

export function OptionCarousel({
  weekday,
  options,
  selectedId,
  readOnly,
  onSelect,
}: {
  weekday: string;
  options: readonly MealOption[];
  selectedId: string | null;
  readOnly: boolean;
  onSelect: (optionId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const cards = cardRefs.current.filter((card): card is HTMLButtonElement => card != null);
    if (cards.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = cards.indexOf(visible.target as HTMLButtonElement);
        if (index >= 0) setActiveIndex(index);
      },
      { root, threshold: 0.6 },
    );
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  }, [options]);

  const scrollToIndex = (index: number) => {
    const card = cardRefs.current[index];
    if (!card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  };

  const moveFocus = (from: number, direction: -1 | 1) => {
    const next = Math.min(options.length - 1, Math.max(0, from + direction));
    cardRefs.current[next]?.focus();
    scrollToIndex(next);
  };

  return (
    <div>
      <div
        ref={scrollerRef}
        role="radiogroup"
        aria-label={`${weekday} dinner options`}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-px-4 -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onPointerDown={(event) => {
          event.stopPropagation();
          dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          if (Math.abs(event.clientX - drag.x) > SWIPE_SLOP_PX || Math.abs(event.clientY - drag.y) > SWIPE_SLOP_PX) {
            drag.moved = true;
          }
        }}
        onKeyDown={(event) => {
          const current = cardRefs.current.findIndex((card) => card === document.activeElement);
          if (current < 0) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveFocus(current, 1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveFocus(current, -1);
          }
        }}
      >
        {options.map((option, index) => {
          const selected = option.id === selectedId;
          return (
            <button
              key={option.id}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={readOnly || undefined}
              className={cn(
                "relative w-[85%] shrink-0 snap-center rounded-[14px] bg-card p-4 text-left shadow-card",
                selected && "ring-2 ring-primary",
              )}
              onClick={() => {
                if (dragRef.current?.moved) {
                  dragRef.current = null;
                  return;
                }
                dragRef.current = null;
                if (readOnly) return;
                onSelect(option.id);
              }}
              onKeyDown={(event) => {
                if (readOnly) return;
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  onSelect(option.id);
                }
              }}
            >
              {selected ? (
                <span className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-4" aria-hidden />
                </span>
              ) : null}
              <p className="type-section pr-10">{option.title}</p>
              {option.pitch ? (
                <p className="type-body mt-2 line-clamp-3 text-muted-foreground">{option.pitch}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="type-chip rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                  {option.prepMinutes} min
                </span>
                <span className="type-chip rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                  {servingsLabel(option.servings)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            aria-label={`Option ${index + 1} of ${options.length}`}
            className="inline-flex min-h-6 min-w-6 items-center justify-center p-2"
            onClick={() => scrollToIndex(index)}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                index === activeIndex ? "bg-primary" : "bg-muted-foreground/30",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
