import { supabase } from '@/integrations/supabase/client';

// Pay stub images used to live in localStorage as base64, which costs ~330KB
// each against a ~5MB budget shared with the whole ledger — about 14 stubs
// before the app can't save anything at all. Signed in, the image goes to
// object storage and the job keeps only a reference.
//
// Signed out it still falls back to a data URI, so attaching a stub works
// without an account, exactly like the rest of the app.

const BUCKET = 'pay-stubs';
const PREFIX = 'storage:';

/** A stored reference rather than the image itself. */
export const isStoredRef = (payStub?: string): boolean => !!payStub?.startsWith(PREFIX);

const pathOf = (payStub: string) => payStub.slice(PREFIX.length);

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Puts the image in the user's own folder and returns the reference to store.
 * Returns null on failure so the caller can keep the data URI instead — a
 * failed upload must never mean a lost stub.
 */
export async function uploadStub(dataUrl: string, userId: string, jobId: string): Promise<string | null> {
  try {
    const blob = dataUrlToBlob(dataUrl);
    // Row security keys on the first path segment being the user's id.
    const path = `${userId}/${jobId}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type,
      upsert: true,
    });
    if (error) { console.error('[stubStorage] upload failed', error); return null; }
    return PREFIX + path;
  } catch (err) {
    console.error('[stubStorage] upload threw', err);
    return null;
  }
}

/** A URL the <img> can actually load: the data URI itself, or a short-lived
 *  signed link for a stored one. The bucket is private, so no public URLs. */
export async function stubViewUrl(payStub?: string): Promise<string | null> {
  if (!payStub) return null;
  if (!isStoredRef(payStub)) return payStub; // already an inline data URI
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pathOf(payStub), 60 * 10);
  if (error) { console.error('[stubStorage] signing failed', error); return null; }
  return data.signedUrl;
}

/** Removes the stored image. Inline stubs need nothing — dropping the field
 *  is enough. */
export async function deleteStub(payStub?: string): Promise<void> {
  if (!isStoredRef(payStub)) return;
  const { error } = await supabase.storage.from(BUCKET).remove([pathOf(payStub!)]);
  if (error) console.error('[stubStorage] delete failed', error);
}
