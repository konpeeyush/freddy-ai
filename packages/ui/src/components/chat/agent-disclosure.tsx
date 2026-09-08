"use client";

import { motion, type HTMLMotionProps, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { EASE_OUT, SPRING_DISCLOSURE } from "@workspace/ui/lib/ease";
import { cn } from "@workspace/ui/lib/utils";

export interface AgentDisclosureProps
  extends Omit<HTMLMotionProps<"div">, "animate" | "initial"> {
  open: boolean;
  openHeight?: CSSProperties["height"];
}

/**
 * Shared reveal for collapsible agent content, opening downwards.
 *
 * The height is animated rather than set, which is the whole point. The
 * upstream registry version put `height: auto | 0` in `style` and animated
 * only opacity and a clip — so the box snapped to full size on the first
 * frame, throwing everything below it down instantly, and *then* spent 220ms
 * fading the rows into the space that had already been made. The jump read as
 * a layout bug the animation was failing to keep up with.
 *
 * Animating the height instead means the container, its contents and every
 * sibling underneath move on the same spring, in the same frames: the panel
 * grows downwards and the page opens up ahead of it.
 *
 * `height: "auto"` is a real target here — Motion measures the laid-out box
 * and animates to that pixel value — so this works without the caller
 * knowing how many rows it is about to show.
 */
export function AgentDisclosure({
  open,
  openHeight = "auto",
  className,
  style,
  transition,
  ...props
}: AgentDisclosureProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <motion.div
      {...props}
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={{
        height: open ? openHeight : 0,
        opacity: open ? 1 : 0,
      }}
      transition={
        transition ??
        (reduce
          ? { duration: 0 }
          : {
              height: SPRING_DISCLOSURE,
              /*
               * Faster than the growth, not matched to it. Fading for the
               * whole opening leaves the rows still washed out once the box
               * has stopped moving, which reads as slow; landing early lets
               * the last of the movement happen to content already solid.
               */
              opacity: { duration: open ? 0.18 : 0.12, ease: EASE_OUT },
            })
      }
      // Rows are clipped by the growing box rather than spilling past it.
      className={cn("overflow-hidden", className)}
      style={{ ...style, pointerEvents: open ? undefined : "none" }}
    />
  );
}
