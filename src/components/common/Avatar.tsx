import React, { useState } from 'react';

export interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showOnline?: boolean;
  role?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-xs',
  lg: 'w-11 h-11 text-sm',
  xl: 'w-14 h-14 text-base font-bold'
};

const indicatorSizes = {
  xs: 'w-2 h-2 ring-1',
  sm: 'w-2.5 h-2.5 ring-1.5',
  md: 'w-3 h-3 ring-2',
  lg: 'w-3.5 h-3.5 ring-2',
  xl: 'w-4 h-4 ring-2'
};

// Deterministic color palette for PULSE initials avatars
const PALETTE = [
  'bg-violet-600 text-white',
  'bg-indigo-600 text-white',
  'bg-emerald-600 text-white',
  'bg-blue-600 text-white',
  'bg-amber-600 text-white',
  'bg-rose-600 text-white',
  'bg-teal-600 text-white',
  'bg-cyan-600 text-white'
];

function getInitials(name: string): string {
  if (!name || !name.trim()) return 'P';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % PALETTE.length;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarUrl,
  src,
  size = 'md',
  className = '',
  showOnline = false
}) => {
  const [imgError, setImgError] = useState(false);
  const initials = getInitials(name);
  const colorClass = PALETTE[getColorIndex(name)];

  const rawUrl = avatarUrl || src;
  const isDicebear = typeof rawUrl === 'string' && rawUrl.includes('dicebear.com');
  const hasValidImage = Boolean(rawUrl && !imgError && !isDicebear && rawUrl.startsWith('http'));

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      title={name}
      aria-label={name}
    >
      {hasValidImage ? (
        <img
          src={rawUrl!}
          alt={name}
          onError={() => setImgError(true)}
          className={`${sizeClasses[size]} rounded-full object-cover ring-1 ring-[var(--border-color)]`}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} ${colorClass} rounded-full flex items-center justify-center font-semibold tracking-wider shadow-2xs ring-1 ring-white/10`}
          title={name}
          aria-label={name}
        >
          {initials}
        </div>
      )}

      {showOnline && (
        <span
          className={`absolute bottom-0 right-0 ${indicatorSizes[size]} bg-emerald-500 rounded-full ring-[var(--surface-primary)] pointer-events-none`}
          title="Online"
        />
      )}
    </div>
  );
};
