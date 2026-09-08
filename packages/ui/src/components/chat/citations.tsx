"use client";
// beui.dev/components/agents/citations — adapted: hugeicons instead of
// lucide, and a hashed colour mark instead of a fetched favicon (see the
// note on CitationMark below).

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useId, useState } from "react";
import { AgentDisclosure } from "./agent-disclosure";
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@workspace/ui/lib/ease";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { cn } from "@workspace/ui/lib/utils";

export interface CitationItem {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
  /** A same-origin favicon endpoint — see CitationMark for why it must be. */
  iconUrl?: string;
}

export interface CitationsProps {
  citations: CitationItem[];
  title?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  idPrefix?: string;
  className?: string;
}

export interface CitationProps {
  citationId: string;
  index: number;
  /** Must match the related Citations idPrefix. */
  idPrefix: string;
  className?: string;
}

export interface CitationListProps {
  citations: CitationItem[];
  idPrefix?: string;
  className?: string;
}

export interface CitationStackProps {
  citations: CitationItem[];
  limit?: number;
  /** "xs" for a compact inline row (beside icon buttons); "sm" for its own line. */
  size?: "xs" | "sm";
  className?: string;
}

function citationTargetId(prefix: string, citationId: string) {
  return `${prefix}-${citationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function Citation({
  citationId,
  index,
  idPrefix,
  className,
}: CitationProps) {
  return (
    <a
      href={`#${citationTargetId(idPrefix, citationId)}`}
      aria-label={`View citation ${index}`}
      className={cn(
        "mx-0.5 inline-flex min-w-5 -translate-y-0.5 cursor-pointer items-center justify-center rounded-md bg-primary/12 px-1 py-0.5 text-[10px] font-semibold leading-none text-primary no-underline outline-none ring-1 ring-primary/20 transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {index}
    </a>
  );
}

/** A stable hue for a string, so a mark keeps its colour wherever it repeats. */
function hueOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/*
 * A real favicon when one is reachable without the visitor asking for it.
 *
 * The upstream registry component fetches each citation's `/favicon.ico`
 * directly from the browser — which means the visitor announcing, to every
 * domain in the reply, that someone on this page asked about it. `iconUrl`
 * is expected to be a same-origin proxy instead (this app's own server
 * fetching on the visitor's behalf), so loading it costs nothing beyond what
 * the reply already revealed. No `iconUrl`, or one that fails to load, falls
 * back to a coloured initial drawn locally — never a second, unproxied
 * request to the domain itself.
 */
export function CitationMark({
  citation,
  className,
}: {
  citation: CitationItem;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const seed =
    typeof citation.domain === "string" && citation.domain
      ? citation.domain
      : citation.id;
  const showIcon = Boolean(citation.iconUrl) && !failed;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white",
        className,
      )}
      style={
        showIcon ? undefined : { background: `oklch(0.58 0.13 ${hueOf(seed)})` }
      }
    >
      {showIcon ? (
        // biome-ignore lint/performance/noImgElement: proxied through our own server, not a remote host `next/image` would need to allowlist.
        <img
          src={citation.iconUrl}
          alt=""
          width={14}
          height={14}
          className="size-3.5 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        seed.charAt(0).toUpperCase()
      )}
    </span>
  );
}

/** One entry per distinct site, first mention wins — three identical marks
 *  for three passages of the same page say nothing a single one didn't. */
function uniqueByDomain(citations: CitationItem[]): CitationItem[] {
  const seen = new Set<string>();
  const out: CitationItem[] = [];
  for (const citation of citations) {
    const key =
      typeof citation.domain === "string" && citation.domain
        ? citation.domain
        : citation.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out;
}

/**
 * Up to `limit` distinct sites' favicons, overlapped shadcn-`Avatar`-style,
 * with a `+n` circle standing in for whatever did not fit — the trigger
 * button's stand-in for "here is roughly what this drew on" before anyone
 * has opened the list.
 */
/*
 * Sizes set directly on the root, not through `Avatar`'s own "sm"/"lg"
 * presets — the preset's diameter lives behind a `data-[size=sm]:` variant,
 * which shares no specificity with a plain override class and so cannot be
 * shrunk further from outside. Bypassing it here is what lets "xs" go below
 * the smallest preset at all.
 */
const STACK_SIZE = {
  xs: { avatar: "size-5", count: "size-5", text: "text-[9px]" },
  sm: { avatar: "size-6", count: "size-6", text: "text-[10px]" },
} as const;

export function CitationStack({
  citations,
  limit = 3,
  size = "sm",
  className,
}: CitationStackProps) {
  const unique = uniqueByDomain(citations);
  const shown = unique.slice(0, limit);
  const overflow = unique.length - shown.length;
  const dims = STACK_SIZE[size];

  return (
    <AvatarGroup aria-hidden="true" className={cn("shrink-0", className)}>
      {shown.map((citation) => {
        const seed =
          typeof citation.domain === "string" && citation.domain
            ? citation.domain
            : citation.id;
        return (
          <Avatar key={citation.id} className={dims.avatar}>
            {citation.iconUrl ? (
              <AvatarImage src={citation.iconUrl} alt="" />
            ) : null}
            <AvatarFallback
              className={cn("font-semibold text-white", dims.text)}
              style={{ background: `oklch(0.58 0.13 ${hueOf(seed)})` }}
            >
              {seed.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {overflow > 0 ? (
        <AvatarGroupCount className={cn(dims.count, dims.text)}>
          +{overflow}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}

function CitationRow({
  citation,
  index,
  idPrefix,
}: {
  citation: CitationItem;
  index: number;
  idPrefix: string;
}) {
  const content = (
    <>
      <CitationMark citation={citation} className="text-[10px]" />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="truncate text-sm font-medium text-foreground/80 transition-colors group-hover/citation:text-foreground">
          {citation.title}
        </span>
        {citation.domain ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground/60">
            {citation.domain}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="grid size-5 place-items-center rounded-md bg-foreground/5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        {citation.url ? (
          <HugeiconsIcon
            icon={LinkSquare02Icon}
            className="size-3.5 text-muted-foreground/40 transition-colors group-hover/citation:text-muted-foreground"
          />
        ) : null}
      </span>
    </>
  );
  const className =
    "group/citation flex items-center gap-2 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const id = citationTargetId(idPrefix, citation.id);

  return citation.url ? (
    <a
      id={id}
      href={citation.url}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div id={id} className={className}>
      {content}
    </div>
  );
}

export function CitationList({
  citations,
  idPrefix,
  className,
}: CitationListProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const resolvedPrefix =
    idPrefix ?? `citation-list-${baseId.replace(/:/g, "")}`;

  return (
    <div className={cn("grid gap-0.5", className)}>
      <AnimatePresence mode="popLayout">
        {citations.map((citation, index) => (
          <motion.div
            layout="position"
            key={citation.id}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.18, ease: EASE_OUT },
                    y: SPRING_LAYOUT,
                    layout: SPRING_LAYOUT,
                  }
            }
          >
            <CitationRow
              citation={citation}
              index={index + 1}
              idPrefix={resolvedPrefix}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Citations({
  citations,
  title = "Sources",
  open,
  defaultOpen = false,
  onOpenChange,
  idPrefix,
  className,
}: CitationsProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const contentId = `${baseId}-content`;
  const resolvedPrefix = idPrefix ?? `citation-${baseId.replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  return (
    <div className={cn("w-full text-sm", className)}>
      <button
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group -ml-1 flex min-h-8 items-center gap-2 rounded-lg px-1 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CitationStack citations={citations} limit={3} />
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          {citations.length}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-muted-foreground/60"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure id={contentId} open={currentOpen}>
        <CitationList
          citations={citations}
          idPrefix={resolvedPrefix}
          className="mt-1"
        />
      </AgentDisclosure>
    </div>
  );
}
