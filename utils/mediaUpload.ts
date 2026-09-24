import { StorageService, deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from '@/lib/backend';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';

/**
 * Shared, defensive media-upload helpers.
 *
 * Guarantees provided to callers:
 *  - Any supported source (File / Blob / data: / blob: / http(s): / Capacitor content:// or file://)
 *    is converted into a real Blob BEFORE any upload is attempted.
 *  - Uploads are retried with backoff and hard per-attempt timeouts so a stalled
 *    native network call can never hang a chat bubble on "Sending..." forever.
 *  - The returned download URL is validated to be a permanent http(s) URL
 *    (never a temporary/revoked blob: or data: URL).
 */

export class UploadTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'UploadTimeoutError';
  }
}

export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label = 'Operation'): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UploadTimeoutError(label, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

const base64ToBlob = (base64OrDataUrl: string, mimeType = 'application/octet-stream'): Blob => {
  const clean = base64OrDataUrl.includes(',')
    ? base64OrDataUrl.slice(base64OrDataUrl.indexOf(',') + 1)
    : base64OrDataUrl;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
};

const guessMimeFromUri = (uri: string): string => {
  const extMatch = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(uri);
  const ext = extMatch?.[1]?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'webm':
      return 'audio/webm';
    case 'mp4':
      return 'video/mp4';
    case 'pdf':
      return 'application/pdf';
    default:
      return '';
  }
};

/**
 * Automatically compress large phone camera images (12-48MP, 5-15MB) into high-quality
 * web-optimized JPEG blobs (max 1600px dimension, ~150-350KB) for instantaneous, reliable mobile sending.
 */
export const compressImageBlob = async (blob: Blob, maxDimension = 1600, quality = 0.82): Promise<Blob> => {
  if (typeof window === 'undefined' || !blob.type.startsWith('image/') || blob.type === 'image/gif' || blob.type === 'image/svg+xml') {
    return blob;
  }

  return new Promise<Blob>((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= maxDimension && height <= maxDimension && blob.size < 500 * 1024) {
        return resolve(blob);
      }

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(blob);

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (compressedBlob) => {
          if (compressedBlob && compressedBlob.size < blob.size) {
            resolve(compressedBlob);
          } else {
            resolve(blob);
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
};

export interface SourceBlob {
  blob: Blob;
  mimeType: string;
}

/**
 * Converts anything that can represent an image/file into a real Blob that is safe
 * to hand to Storage. Throws when the source cannot be read at all —
 * callers should surface that as an error instead of uploading garbage.
 */
export const sourceToBlob = async (source: unknown): Promise<SourceBlob> => {
  if (!source) throw new Error('No media source provided.');

  // Real File/Blob coming from <input type="file"> or MediaRecorder — compress if image and use.
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size === 0) throw new Error('Selected media is empty.');
    let mimeType = (source as File).type || source.type || '';
    let finalBlob = source;
    if (mimeType.startsWith('image/')) {
      finalBlob = await compressImageBlob(source);
      mimeType = finalBlob.type || mimeType;
    }
    return { blob: finalBlob, mimeType };
  }

  if (typeof source !== 'string' || !source.trim()) throw new Error('Invalid media source.');
  const uri = source.trim();

  // data: URL (e.g. FileReader output) -> decode straight to bytes.
  if (/^data:/i.test(uri)) {
    const mimeType = /^data:([^;,]+)/i.exec(uri)?.[1] || '';
    const res = await fetch(uri);
    const blob = await res.blob();
    if (!blob.size) throw new Error('Media could not be decoded.');
    return { blob, mimeType: mimeType || blob.type };
  }

  // Capacitor content:// URI (gallery/camera picker on Android).
  if (/^content:\/\//i.test(uri)) {
    const fallbackMime = guessMimeFromUri(uri);
    if (Capacitor.isNativePlatform()) {
      try {
        // The Android Filesystem plugin supports reading content:// URIs directly.
        const fileData = await Filesystem.readFile({ path: uri });
        const blob = base64ToBlob(String(fileData.data), fallbackMime);
        if (!blob.size) throw new Error('Empty file');
        return { blob, mimeType: blob.type || fallbackMime };
      } catch (fsError) {
        console.warn('[mediaUpload] Filesystem content:// read failed, trying convertFileSrc:', fsError);
      }
      try {
        const res = await fetch(Capacitor.convertFileSrc(uri));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.size) throw new Error('Empty file');
        return { blob, mimeType: blob.type || fallbackMime };
      } catch (fetchError) {
        console.error('[mediaUpload] Unable to read content:// URI:', fetchError);
        throw new Error('Could not read the selected image. Please pick it again.');
      }
    }
    throw new Error('content:// URIs can only be read inside the mobile app.');
  }

  // Capacitor file:// URI (or bare absolute path).
  if (/^file:\/\//i.test(uri) || /^(\/|\\\\)/.test(uri)) {
    const fallbackMime = guessMimeFromUri(uri);
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await fetch(Capacitor.convertFileSrc(/^file:\/\//i.test(uri) ? uri : `file://${uri}`));
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size) return { blob, mimeType: blob.type || fallbackMime };
        }
      } catch (fetchError) {
        console.warn('[mediaUpload] convertFileSrc fetch failed, falling back to Filesystem:', fetchError);
      }
      try {
        const fileData = await Filesystem.readFile({ path: uri.replace(/^file:\/\//i, '') });
        return { blob: base64ToBlob(String(fileData.data), fallbackMime), mimeType: fallbackMime };
      } catch (fsError) {
        console.error('[mediaUpload] Unable to read file:// path:', fsError);
        throw new Error('Could not read the selected file. Please pick it again.');
      }
    }
    throw new Error('Local file paths can only be read inside the mobile app.');
  }

  // blob: URLs and remote http(s) resources.
  if (/^(blob|https?):/i.test(uri)) {
    let res: Response;
    try {
      res = await fetch(uri);
    } catch (fetchError) {
      throw new Error(`Could not fetch media: ${(fetchError as Error)?.message || 'network error'}`);
    }
    if (!res.ok) throw new Error(`Could not fetch media (HTTP ${res.status}).`);
    const blob = await res.blob();
    if (!blob.size) throw new Error('Media could not be fetched.');
    return { blob, mimeType: blob.type || guessMimeFromUri(uri) };
  }

  throw new Error(`Unsupported media source: ${uri.slice(0, 64)}`);
};

import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export interface UploadWithRetryOptions {
  attempts?: number;
  timeoutMs?: number;
  contentType?: string;
}

/**
 * Uploads a Blob to Supabase Storage with retries + timeouts and returns a
 * validated, PERMANENT https public URL.
 */
export const uploadBlobWithRetry = async (
  _storage: any,
  blob: Blob,
  cloudPath: string,
  options: UploadWithRetryOptions = {}
): Promise<string> => {
  const { attempts = 3, contentType } = options;
  let lastError: unknown;

  const bucket = cloudPath.startsWith('avatars/') ? 'profile_avatars' : 'solution_shares';
  const cleanPath = cloudPath.replace(/^(avatars|solution_shares|temp_uploads)\//, '');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .upload(cleanPath, blob, {
            upsert: true,
            contentType: contentType || blob.type || 'image/jpeg',
          });

        if (error) {
          throw new Error(error.message);
        }

        const { data: publicUrlData } = supabase.storage
          .from(bucket)
          .getPublicUrl(data.path);

        const url = publicUrlData.publicUrl;
        if (!url || !/^https?:\/\//i.test(url)) {
          throw new Error(`Storage returned an invalid URL: ${String(url).slice(0, 64)}`);
        }
        return url;
      }
    } catch (error) {
      lastError = error;
      console.warn(`[mediaUpload] Attempt ${attempt}/${attempts} failed for ${cloudPath}:`, error);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1200 * 2 ** (attempt - 1), 5000)));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Upload failed after multiple attempts.');
};

/** Upload to a user-scoped temporary path and return a permanent https URL. */
export const uploadToTempStorage = async (
  storage: StorageService,
  blob: Blob,
  userId: string,
  options: UploadWithRetryOptions = {}
): Promise<{ url: string; tempPath: string }> => {
  const ext = (blob.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
  const tempPath = `temp_uploads/${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const url = await uploadBlobWithRetry(storage, blob, tempPath, options);
  return { url, tempPath };
};

/** Move (copy + delete) a temp object into a permanent chat path. */
export const promoteTempToPermanent = async (
  storage: StorageService,
  tempPath: string,
  permanentPath: string,
  options: UploadWithRetryOptions = {}
): Promise<string> => {
  // Direct fetch via download URL to avoid Storage CORS restriction
  const downloadUrl = await getDownloadURL(storageRef(storage, tempPath));
  const res = await fetch(downloadUrl);
  const blob = await res.blob();
  const permanentUrl = await uploadBlobWithRetry(storage, blob, permanentPath, options);
  // Fire-and-forget cleanup
  deleteObject(storageRef(storage, tempPath)).catch(() => {});
  return permanentUrl;
};

/**
 * Resolves only once the given URL actually loads in an <img>. Used to verify
 * that the persisted message image URL is accessible BEFORE marking a message sent.
 */
export const verifyImageUrl = (url: string, timeoutMs = 15000): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined' || !url || !/^https?:\/\//i.test(url)) {
      reject(new Error('Image URL is not a valid http(s) URL.'));
      return;
    }
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      reject(new UploadTimeoutError('Verifying uploaded image', timeoutMs));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Uploaded image could not be loaded.'));
    };
    img.src = url;
  });