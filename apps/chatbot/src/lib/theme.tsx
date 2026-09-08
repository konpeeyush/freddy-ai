import { createContext, useContext } from "react"

export type ResolvedTheme = "light" | "dark"

type ThemeContextValue = {
  theme: ResolvedTheme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const ThemeProvider = ThemeContext.Provider

/**
 * The theme flag lives on the host element (tokens are declared on `:host`),
 * which is outside React's tree — so it is threaded through context rather
 * than read from the DOM.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
