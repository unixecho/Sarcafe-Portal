export const STAFF_AVATARS = ['☕', '🥐', '🫘', '🌿', '🌞', '🌙', '⭐', '🍊', '🍓', '🍪', '🧁', '🐻', '🦊', '🐼', '🦋', '🌻', '🎧', '⚡', '✨', '💛'] as const

export type StaffAvatar = (typeof STAFF_AVATARS)[number]

export function isStaffAvatar(value: unknown): value is StaffAvatar {
  return typeof value === 'string' && (STAFF_AVATARS as readonly string[]).includes(value)
}
