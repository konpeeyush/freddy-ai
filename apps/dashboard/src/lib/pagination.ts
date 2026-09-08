/** The four-state enum `@workspace/ui`'s `useInfiniteScroll` expects — a
 *  vocabulary this repo inherited from Convex's pagination hook, kept as the
 *  hook's contract even though nothing here is Convex-backed. Every list in
 *  this app is a plain TanStack `useInfiniteQuery`, so this is the one place
 *  that translates React Query's own status fields into it. */
export type PaginationStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted"

export function paginationStatus(query: {
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
}): PaginationStatus {
  if (query.isLoading) return "LoadingFirstPage"
  if (query.isFetchingNextPage) return "LoadingMore"
  if (query.hasNextPage) return "CanLoadMore"
  return "Exhausted"
}
