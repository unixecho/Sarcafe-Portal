import 'server-only'

import { createHash } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { PHOTO_MAX_SIDE, PHOTO_MIN_SIDE, PHOTO_UPLOAD_MAX_BYTES } from '@/lib/identity/registration'

// The only way a photograph enters the identity system (FABLE-003). Nothing a person uploads is stored as it came: the bytes must be
// one of three raster formats by their own signature (not by a file name or a declared type), decode completely as ONE still image
// within a pixel budget, and are then re-encoded by the server into a fresh JPEG with no metadata at all (no EXIF, no GPS, no
// camera, no colour profile beyond sRGB, no comments), turned upright by its orientation first and made at most PHOTO_MAX_SIDE on
// its long side. SVG, HTML, PDF, GIF, HEIC, animated images, truncated files and decompression bombs are refused before anything
// is written. sharp (libvips) is pinned in package.json; its limits below are the second lock after the byte cap.

export type Portrait = { jpeg: Buffer; width: number; height: number; sha256: string }
export type PortraitRefusal = 'too_large' | 'not_an_image' | 'unsupported' | 'animated' | 'too_small' | 'too_many_pixels' | 'unreadable'

/** At most this many decoded pixels (40 MP: a 7,000 x 5,700 photo). A bomb that declares more is refused before it is decoded. */
const MAX_INPUT_PIXELS = 40_000_000
const OUTPUT_MAX_BYTES = 2 * 1024 * 1024

/** The format the bytes themselves say they are (magic numbers), or null. Never the file name, never the Content-Type. */
export function sniffImage(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'png'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  return null
}

export async function processPortrait(input: Uint8Array): Promise<{ ok: true; portrait: Portrait } | { ok: false; reason: PortraitRefusal }> {
  if (input.length === 0) return { ok: false, reason: 'not_an_image' }
  if (input.length > PHOTO_UPLOAD_MAX_BYTES) return { ok: false, reason: 'too_large' }
  const format = sniffImage(input)
  if (!format) return { ok: false, reason: 'not_an_image' }

  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' as const, animated: false, sequentialRead: true }
  let meta: Metadata
  try {
    meta = await sharp(input, options).metadata()
  } catch (error) {
    return { ok: false, reason: /pixel limit/i.test(String((error as Error)?.message)) ? 'too_many_pixels' : 'unreadable' }
  }
  // the decoder's own answer must agree with the signature (a PNG signature on something libvips reads as SVG is refused)
  if (meta.format !== format) return { ok: false, reason: 'unsupported' }
  if ((meta.pages ?? 1) > 1) return { ok: false, reason: 'animated' }
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) return { ok: false, reason: 'unreadable' }
  if (width * height > MAX_INPUT_PIXELS) return { ok: false, reason: 'too_many_pixels' }
  // orientation 5-8 swaps the sides once the image is turned upright
  const upright = (meta.orientation ?? 1) >= 5 ? { w: height, h: width } : { w: width, h: height }
  if (Math.min(upright.w, upright.h) < PHOTO_MIN_SIDE) return { ok: false, reason: 'too_small' }

  try {
    const { data, info } = await sharp(input, options)
      .timeout({ seconds: 10 })
      .rotate() // by the EXIF orientation, which is then gone with the rest of the metadata
      .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // a transparent PNG / WebP gets a plain background, never black
      .toColourspace('srgb')
      .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer({ resolveWithObject: true })
    if (data.length > OUTPUT_MAX_BYTES) return { ok: false, reason: 'too_large' }
    // the result is checked once more: one JPEG, the expected size, no metadata block left in it
    const out = await sharp(data).metadata()
    if (out.format !== 'jpeg' || out.exif || out.icc || out.iptc || out.xmp || (out.pages ?? 1) > 1) return { ok: false, reason: 'unreadable' }
    return { ok: true, portrait: { jpeg: data, width: info.width, height: info.height, sha256: createHash('sha256').update(data).digest('hex') } }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** What to tell the person (Hebrew), for each refusal. It never echoes the file name or any of its content. */
export const PORTRAIT_TEXT: Record<PortraitRefusal, string> = {
  too_large: 'הקובץ גדול מדי. אפשר להעלות תמונה עד 8MB.',
  not_an_image: 'זה לא קובץ תמונה. אפשר להעלות JPG, PNG או WebP.',
  unsupported: 'סוג התמונה הזה אינו נתמך. אפשר להעלות JPG, PNG או WebP.',
  animated: 'תמונה מונפשת אינה מתאימה. העלו תמונה רגילה של הפנים.',
  too_small: 'התמונה קטנה מדי. צריך לפחות 200 פיקסלים בכל צד.',
  too_many_pixels: 'התמונה גדולה מדי (יותר מדי פיקסלים). העלו תמונה קטנה יותר.',
  unreadable: 'לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת.',
}
