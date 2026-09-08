"use client";

import type React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { cn } from "@workspace/ui/lib/utils";

interface DicebearAvatarProps {
  seed: string;
  size?: number;
  className?: string;
  badgeImageUrl?: string;
  imageUrl?: string;
}

export function DicebearAvatar({
  seed,
  size = 32,
  className,
  badgeImageUrl,
  imageUrl,
}: DicebearAvatarProps): React.ReactElement {
  const avatarUrl =
    imageUrl ??
    `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(seed)}`;

  const badgeSize = Math.round(size * 0.4);

  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <Avatar
        className={cn("size-full", className)}
        style={{ fontSize: `${size * 0.4}px` }}
      >
        <AvatarImage alt="avatar" src={avatarUrl} />
        <AvatarFallback>{seed.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      {badgeImageUrl && (
        <div
          className="absolute right-0 bottom-0 overflow-hidden rounded-full ring-2 ring-background"
          style={{ height: badgeSize, width: badgeSize }}
        >
          <img
            alt="badge"
            className="size-full object-cover"
            height={badgeSize}
            src={badgeImageUrl}
            width={badgeSize}
          />
        </div>
      )}
    </div>
  );
}
