import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, ArrowUp01Icon, Tick01Icon } from "@hugeicons/core-free-icons"

import type { ConversationStatus } from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

export function ConversationStatusButton({
  status,
  onClick,
  disabled,
}: {
  status: ConversationStatus
  onClick: () => void
  disabled?: boolean
}) {
  if (status === "resolved") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button disabled={disabled} onClick={onClick} size="sm" variant="secondary">
              <HugeiconsIcon icon={Tick01Icon} />
              Resolved
            </Button>
          }
        />
        <TooltipContent>Mark as unresolved</TooltipContent>
      </Tooltip>
    )
  }

  if (status === "escalated") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              disabled={disabled}
              onClick={onClick}
              size="sm"
              variant="outline"
              className="border-warning/40 text-warning-foreground"
            >
              <HugeiconsIcon icon={ArrowUp01Icon} />
              Escalated
            </Button>
          }
        />
        <TooltipContent>Mark as resolved</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button disabled={disabled} onClick={onClick} size="sm" variant="destructive">
            <HugeiconsIcon icon={ArrowRight01Icon} />
            Unresolved
          </Button>
        }
      />
      <TooltipContent>Mark as escalated</TooltipContent>
    </Tooltip>
  )
}
