import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@workspace/ui/lib/utils"

import { Freddy } from "../chat/freddy"

export function Bubble({
  open,
  onClick,
  className,
}: {
  open: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Close chat" : "Open chat"}
      aria-expanded={open}
      className={cn(
        "pointer-events-auto flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-200 hover:scale-105 active:scale-95",
        className
      )}
    >
      {/*
       * Closed, the trigger is Freddy himself rather than a speech bubble —
       * it is the first thing anyone sees of the assistant, and the same face
       * greets them in the header once the panel opens. Open, it goes back to
       * a plain cross: the button's job there is to dismiss, and a waving
       * mascot on a close button reads as the wrong affordance.
       */}
      {open ? (
        <HugeiconsIcon icon={Cancel01Icon} className="size-6" />
      ) : (
        <Freddy size={40} ariaLabel="Freddy" />
      )}
    </button>
  )
}
