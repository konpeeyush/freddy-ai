import type React from "react";
import { forwardRef } from "react";
import { Button } from "@workspace/ui/components/button";
import { Dotm3x3_16 } from "@workspace/ui/components/ui/dotm-3x3-16";
import { cn } from "@workspace/ui/lib/utils";

interface InfiniteScrollTriggerProps {
  canLoadMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  loadMoreText?: string;
  noMoreText?: string;
  className?: string;
}

export const InfiniteScrollTrigger = forwardRef<
  HTMLDivElement,
  InfiniteScrollTriggerProps
>(
  (
    {
      canLoadMore,
      isLoadingMore,
      onLoadMore,
      loadMoreText = "Load more",
      noMoreText = "No more items",
      className,
    },
    ref,
  ): React.ReactElement => {
    let content: React.ReactNode = null;

    if (canLoadMore) {
      content = (
        <Button onClick={onLoadMore} size="sm" variant="outline">
          {loadMoreText}
        </Button>
      );
    } else if (isLoadingMore) {
      content = (
        <span className="flex items-center gap-2 text-muted-foreground text-sm">
          <Dotm3x3_16 size={14} />
          Loading...
        </span>
      );
    } else {
      content = (
        <span className="text-muted-foreground text-sm">{noMoreText}</span>
      );
    }

    return (
      <div
        className={cn("flex w-full justify-center py-2", className)}
        ref={ref}
      >
        {content}
      </div>
    );
  },
);

InfiniteScrollTrigger.displayName = "InfiniteScrollTrigger";
