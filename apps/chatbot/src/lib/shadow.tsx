import { createContext, useContext } from "react"

/**
 * The element portalled popups mount into.
 *
 * Base UI portals default to `document.body`, which is outside our shadow
 * boundary — a portalled popup would render unstyled, since the injected
 * stylesheet only exists inside the root. It also cannot go on the bare shadow
 * root: the React container is `display: contents`, leaving a portal there with
 * no stacking context, so it paints behind the host page. `mount()` creates a
 * fixed, high-z-index layer for it instead.
 */
const ShadowContext = createContext<HTMLElement | null>(null)

export const ShadowProvider = ShadowContext.Provider

export function usePortalContainer(): HTMLElement | null {
  return useContext(ShadowContext)
}
