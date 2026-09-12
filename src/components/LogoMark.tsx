import Image from 'next/image'

/**
 * The recovered Sarcafe mark, always on its own solid cream badge — the
 * logo file itself is transparent (a sticker-style cutout), and floating
 * it bare over a dark or photographic background looks unfinished. Every
 * place the logo appears (portal hero, login, the Google auth handoff,
 * the menu onboarding wizard) goes through this one component instead of
 * repeating the badge treatment ad hoc.
 */
export default function LogoMark({
  size = 64,
  shadow = true,
  radius = size / 2,
}: {
  size?: number
  shadow?: boolean
  /** Defaults to a full circle (a standalone badge); pass a smaller value
   * (e.g. 18) to match a squarer sibling, like the Google "G" tile it
   * pairs with in AuthHandoff's handshake animation. */
  radius?: number
}) {
  const pad = Math.round(size * 0.06)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: '#fdf6ec',
        display: 'grid',
        placeItems: 'center',
        boxShadow: shadow ? '0 10px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04)' : undefined,
        flexShrink: 0,
      }}
    >
      <Image
        src="/sarcafe-logo.png"
        alt=""
        width={size - pad * 2}
        height={size - pad * 2}
        priority
        style={{ objectFit: 'contain' }}
      />
    </div>
  )
}
