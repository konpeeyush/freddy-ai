import { useCallback, useEffect, useMemo, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { FloatingContainer } from "./containers/floating"
import { InlineContainer } from "./containers/inline"
import { FullscreenContainer } from "./containers/fullscreen"
import { ShadowProvider } from "./lib/shadow"
import { WidgetConfigProvider } from "./lib/widget-config"
import { ThemeProvider, type ResolvedTheme } from "./lib/theme"
import type { WidgetConfig } from "./lib/config"

export type WidgetHandle = {
  open: () => void
  close: () => void
  toggle: () => void
  setTheme: (theme: ResolvedTheme) => void
  /**
   * Swaps which tools reach the model, in place.
   *
   * In place because the conversation is the thing being tested: comparing
   * behaviour with a tool withheld means asking the *same* question again,
   * which needs the transcript that question is already in. Remounting to
   * change the tool set would throw away the comparison being set up.
   */
  setTools: (tools: string[] | undefined) => void
}

export function App({
  portalContainer,
  config,
  initialTheme,
  onThemeChange,
  onReady,
}: {
  portalContainer: HTMLElement
  config: WidgetConfig
  initialTheme: ResolvedTheme
  /** Writes the flag to the host element, which lives outside React. */
  onThemeChange: (theme: ResolvedTheme) => void
  onReady?: (handle: WidgetHandle) => void
}) {
  /*
   * One client per widget instance. Two widgets on a page should not share a
   * conversation, and a module-level client would leak between them.
   */
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The conversation is written by hand, never refetched.
            staleTime: Infinity,
            gcTime: Infinity,
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
    []
  )

  const [open, setOpen] = useState(config.defaultOpen)
  const [theme, setThemeState] = useState<ResolvedTheme>(initialTheme)
  /*
   * The one part of config that changes without a remount.
   *
   * Everything else on `config` alters the tree shape (mode, position,
   * trigger) and remounts by design. The tool set only changes what the next
   * request carries, so it can move under a live conversation — which is the
   * whole point of being able to change it.
   */
  const [tools, setTools] = useState(config.tools)

  // A real remount (mode change, new element) still resets it: the prop is
  // the source of truth, this state only tracks changes made after mount.
  const liveConfig = useMemo(() => ({ ...config, tools }), [config, tools])

  const setTheme = useCallback(
    (next: ResolvedTheme) => {
      setThemeState(next)
      onThemeChange(next)
    },
    [onThemeChange]
  )

  const toggle = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [theme, setTheme]
  )

  // Expose imperative controls so a host page can drive the widget from its
  // own button — e.g. a "Contact support" link in their nav.
  useEffect(() => {
    onReady?.({
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
      setTheme,
      setTools,
    })
  }, [onReady, setTheme])

  const content =
    config.mode === "inline" ? (
      <InlineContainer />
    ) : config.mode === "fullscreen" ? (
      open ? (
        <FullscreenContainer onClose={() => setOpen(false)} />
      ) : null
    ) : (
      <FloatingContainer
        open={open}
        onToggle={() => setOpen((v) => !v)}
        position={config.position}
        showTrigger={config.trigger === "bubble"}
      />
    )

  return (
    <QueryClientProvider client={queryClient}>
      <WidgetConfigProvider value={liveConfig}>
        <ShadowProvider value={portalContainer}>
          <ThemeProvider value={{ theme, toggle }}>{content}</ThemeProvider>
        </ShadowProvider>
      </WidgetConfigProvider>
    </QueryClientProvider>
  )
}
