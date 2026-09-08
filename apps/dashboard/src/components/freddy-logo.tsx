import { HugeiconsIcon } from "@hugeicons/react"
import { ChatBotIcon } from "@hugeicons/core-free-icons"
import { AvatarCanvas } from "@claykit/react"
import { validateAvatarDefinition, type AvatarDefinition } from "@claykit/core"

import { cn } from "@workspace/ui/lib/utils"

import rawDefinition from "./freddy.avatar.json"

/**
 * The dashboard's brand mark — the same claykit "Freddy" avatar the widget
 * greets visitors with, at rest. Validated once at module scope, same as the
 * widget's own copy: a definition this build ships with should never fail to
 * parse, but a plain icon is a better failure than a blank sidebar corner.
 */
function parseDefinition(source: unknown): AvatarDefinition | null {
  const result = validateAvatarDefinition(source)
  if (result.ok) return result.value
  console.error("[freddy-logo] avatar definition rejected:", result.errors[0]?.message)
  return null
}

const definition = parseDefinition(rawDefinition)

export function FreddyLogo({
  size = 28,
  className,
}: {
  size?: number | string
  className?: string
}) {
  if (!definition) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground",
          className
        )}
        style={{ width: size, height: size }}
      >
        <HugeiconsIcon icon={ChatBotIcon} className="size-[65%]" />
      </span>
    )
  }

  return (
    <AvatarCanvas
      definition={definition}
      finish="clay"
      animation="idle"
      size={size}
      ariaLabel="freddy-ai"
      className={cn("shrink-0", className)}
    />
  )
}
