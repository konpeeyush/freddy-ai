import type React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  ArrowUp01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@workspace/ui/lib/utils";

type ConversationStatus = "unresolved" | "escalated" | "resolved";

export function ConversationStatusIcon({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}): React.ReactElement {
  if (status === "resolved") {
    return (
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full bg-success",
          className,
        )}
      >
        <HugeiconsIcon icon={Tick01Icon} className="size-3 text-success-foreground" />
      </div>
    );
  }

  if (status === "escalated") {
    return (
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full bg-warning",
          className,
        )}
      >
        <HugeiconsIcon icon={ArrowUp01Icon} className="size-3 text-warning-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full bg-destructive",
        className,
      )}
    >
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-3 text-white" />
    </div>
  );
}
