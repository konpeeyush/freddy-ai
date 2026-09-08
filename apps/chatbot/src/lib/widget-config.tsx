import { createContext, useContext } from "react"

import type { WidgetConfig } from "./config"

/**
 * The parsed element attributes.
 *
 * Context rather than props: the panel needs `apiUrl`, and it sits three
 * containers deep — threading it through each one would make every container
 * care about a value it does not use.
 */
const ConfigContext = createContext<WidgetConfig | null>(null)

export const WidgetConfigProvider = ConfigContext.Provider

export function useWidgetConfig(): WidgetConfig {
  const config = useContext(ConfigContext)
  if (!config) {
    throw new Error("useWidgetConfig must be used within WidgetConfigProvider")
  }
  return config
}
