// Which uploads are accepted as email images. The type is decided from the
// file's first bytes ("magic numbers"), never from its name or the browser's
// claimed MIME type. SVG is deliberately not supported: it can carry scripts
// and most email clients don't render it anyway. Pure and client-safe.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const IMAGE_TYPES = {
  "image/png": { extension: "png", label: "PNG" },
  "image/jpeg": { extension: "jpg", label: "JPEG" },
  "image/gif": { extension: "gif", label: "GIF" },
  "image/webp": { extension: "webp", label: "WebP" },
} as const;

export type ImageContentType = keyof typeof IMAGE_TYPES;

/** For <input type="file" accept>. */
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(",");

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && Object.hasOwn(IMAGE_TYPES, value);
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/** The image type of a file, from its leading bytes. Null when it isn't an accepted image. */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export type ImageCheck = { ok: true; contentType: ImageContentType } | { ok: false; error: string };

export const IMAGE_TYPE_ERROR = "That file isn't a supported image. Upload a PNG, JPEG, GIF or WebP file.";
export const IMAGE_SIZE_ERROR = "That image is too large. The limit is 2 MB - compress or resize it and try again.";
export const IMAGE_EMPTY_ERROR = "Choose an image file to upload.";

/** Validate an upload's size and real type, with a message that can be shown to the user. */
export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: IMAGE_EMPTY_ERROR };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: IMAGE_SIZE_ERROR };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, error: IMAGE_TYPE_ERROR };
  return { ok: true, contentType };
}

/**
 * A tidy display name for an upload: no path, no control characters, at most
 * 100 characters, and an extension that matches the real type.
 */
export function cleanImageName(name: string, contentType: ImageContentType): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .trim()
    .slice(0, 100);
  return `${base || "image"}.${IMAGE_TYPES[contentType].extension}`;
}
