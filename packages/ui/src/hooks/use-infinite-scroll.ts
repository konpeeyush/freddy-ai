"use client";

import { useCallback, useEffect, useRef } from "react";

type PaginationStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

interface UseInfiniteScrollProps {
  status: PaginationStatus;
  loadMore: (numItems: number) => void;
  loadSize?: number;
  observerEnabled?: boolean;
}

export function useInfiniteScroll({
  status,
  loadMore,
  loadSize = 10,
  observerEnabled = true,
}: UseInfiniteScrollProps) {
  const topElementRef = useRef<HTMLDivElement>(null);

  const handleLoadMore = useCallback(() => {
    if (status === "CanLoadMore") {
      loadMore(loadSize);
    }
  }, [status, loadMore, loadSize]);

  useEffect(() => {
    const topElement = topElementRef.current;

    if (!topElement || !observerEnabled) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(topElement);

    return () => observer.disconnect();
  }, [handleLoadMore, observerEnabled]);

  return {
    canLoadMore: status === "CanLoadMore",
    handleLoadMore,
    isLoadingFirstPage: status === "LoadingFirstPage",
    isLoadingMore: status === "LoadingMore",
    topElementRef,
  };
}
