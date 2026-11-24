import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'

// The private photo bucket (FABLE-003). Only this file touches it, always with the service role, and only with an object path the
// database gave or fixed (org/<organization id>/<photo id>.jpg). No signed URL is ever made and no listing is ever asked: a photo
// leaves storage only through the server proxy routes, after customer_photo_open rechecked the viewer and wrote its audit row.

export const PHOTO_BUCKET = 'customer-identity-photos'
const PATH = /^org\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/

const valid = (path: string) => PATH.test(path)

/** Stores a re-encoded portrait. Never overwrites (upsert off): an id is used once. Throws when storage does not answer. */
export async function putPhoto(path: string, jpeg: Buffer): Promise<void> {
  if (!valid(path)) throw new Error('photo path')
  const { error } = await createServiceRoleClient().storage.from(PHOTO_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' })
  if (error) throw new Error('photo upload')
}

/** The stored bytes, or null when the object is not there. Throws when storage does not answer. */
export async function getPhoto(path: string): Promise<Buffer | null> {
  if (!valid(path)) return null
  const { data, error } = await createServiceRoleClient().storage.from(PHOTO_BUCKET).download(path)
  if (error) {
    const status = Number((error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode)
    if (status === 400 || status === 404 || /not.?found/i.test(error.message)) return null
    throw new Error('photo download')
  }
  return Buffer.from(await data.arrayBuffer())
}

/** Deletes objects (the cleanup job, or an upload whose application failed). A missing object is not an error. */
export async function removePhotos(paths: string[]): Promise<void> {
  const list = paths.filter(valid)
  if (list.length === 0) return
  const { error } = await createServiceRoleClient().storage.from(PHOTO_BUCKET).remove(list)
  if (error) throw new Error('photo remove')
}
