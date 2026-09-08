"use client"

import { cn } from "@workspace/ui/lib/utils"

export interface MessageBubbleProps {
  message: string
  variant?: "sent" | "received"
  className?: string
  children?: React.ReactNode
}

export function MessageBubble({
  message,
  variant = "received",
  className,
  children,
}: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-2xl px-4 py-2 break-words",
        variant === "sent"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
        className
      )}
    >
      {children || <p className="whitespace-pre-wrap">{message}</p>}
    </div>
  )
}
