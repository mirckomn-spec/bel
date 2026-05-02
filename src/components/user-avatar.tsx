"use client";

import { useState } from "react";

const DEFAULT_AVATAR = "/avatar-default.svg";

type UserAvatarProps = {
  username: string;
  className?: string;
  alt?: string;
};

export function UserAvatar({ username, className = "h-9 w-9", alt = "" }: UserAvatarProps) {
  const [src, setSrc] = useState(`/api/profile/avatar/${encodeURIComponent(username)}`);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`rounded-full border border-[#BC8A6F44] object-cover bg-[#e7e5e4] ${className}`}
      onError={() => setSrc(DEFAULT_AVATAR)}
    />
  );
}
