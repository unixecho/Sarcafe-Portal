// Colours that come from the database (a person's colour, a point's colour) end up
// interpolated into a `style` attribute, so they are validated on the way in: a
// hex triplet or nothing. An owner typing something clever into a colour field must
// never be able to reach a CSS value. Pure.

const HEX6 = /^#[0-9a-fA-F]{6}$/

export function safeColour(value: string | null | undefined, fallback: string): string {
  return value && HEX6.test(value) ? value : fallback
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

const DARK = '#150f0c' // --bg
const LIGHT = '#fdf6ec' // --text

/** Text colour that reads on a disc of `hex`: whichever of the two house inks has the higher contrast. */
export function inkOn(hex: string): string {
  if (!HEX6.test(hex)) return LIGHT
  const l = luminance(hex)
  const darkContrast = (l + 0.05) / (luminance(DARK) + 0.05)
  const lightContrast = (luminance(LIGHT) + 0.05) / (l + 0.05)
  return darkContrast >= lightContrast ? DARK : LIGHT
}
