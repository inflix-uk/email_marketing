import type { Readable } from "node:stream";
import { GridFSBucket, type Collection, type ObjectId } from "mongodb";
import { getDb } from "@/db";
import { newId } from "@/db/schema";
import { checkImage, cleanImageName, isImageContentType, type ImageContentType } from "./image-type";

// Images uploaded for use in emails, stored in MongoDB GridFS (bucket
// "uploads": collections uploads.files + uploads.chunks) so they travel with
// the database - no disk or object storage to configure. They are served
// publicly by GET /api/files/<id>, because recipients' mail clients fetch them.

export const UPLOADS_BUCKET = "uploads";

/** [uploads.files] Like every other collection, `_id` is a string UUID. */
interface UploadFileDoc {
  _id: string;
  length: number;
  chunkSize: number;
  uploadDate: Date;
  filename: string;
  metadata?: {
    /** Detected from the file's bytes at upload time. */
    contentType?: string;
    /** Email of the admin who uploaded it. */
    uploadedBy?: string | null;
  };
}

export interface StoredImage {
  id: string;
  name: string;
  contentType: ImageContentType;
  /** Bytes. */
  size: number;
  uploadedAt: Date;
}

const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** File ids are UUIDs; anything else can't exist - skip the query. */
export function isPlausibleFileId(id: string): boolean {
  return FILE_ID_RE.test(id);
}

/** Path of the public route that serves an upload. */
export function imagePath(id: string): string {
  return `/api/files/${id}`;
}

/** Absolute URL for use inside emails (`appUrl` from settings). */
export function imageUrl(appUrl: string, id: string): string {
  return appUrl.trim().replace(/\/+$/, "") + imagePath(id);
}

// The driver types GridFS ids as ObjectId, but stores and queries whatever it
// is given; we use string UUIDs like everywhere else in this app.
const gridId = (id: string) => id as unknown as ObjectId;

const globalForUploads = globalThis as unknown as { uploadsIndexed?: Promise<unknown> };

async function open(): Promise<{ bucket: GridFSBucket; files: Collection<UploadFileDoc> }> {
  const db = await getDb();
  const files = db.collection<UploadFileDoc>(`${UPLOADS_BUCKET}.files`);
  // For the "recent images" list. Once per process; a failure only costs speed.
  globalForUploads.uploadsIndexed ??= files.createIndex({ uploadDate: -1 }).catch(() => {});
  return { bucket: new GridFSBucket(db, { bucketName: UPLOADS_BUCKET }), files };
}

function toStoredImage(doc: UploadFileDoc): StoredImage | null {
  const contentType = doc.metadata?.contentType;
  if (!isImageContentType(contentType)) return null;
  return { id: doc._id, name: doc.filename, contentType, size: doc.length, uploadedAt: doc.uploadDate };
}

export type SaveImageResult = { ok: true; image: StoredImage } | { ok: false; error: string };

/**
 * Validate (size, real file type) and store an uploaded image.
 * `name` is only a label; the content type comes from the bytes.
 */
export async function saveImage(bytes: Uint8Array, name: string, uploadedBy: string | null): Promise<SaveImageResult> {
  const check = checkImage(bytes);
  if (!check.ok) return check;

  const { bucket } = await open();
  const id = newId();
  const filename = cleanImageName(name, check.contentType);
  const stream = bucket.openUploadStreamWithId(gridId(id), filename, {
    metadata: { contentType: check.contentType, uploadedBy },
  });
  await new Promise<void>((resolve, reject) => {
    stream.once("finish", () => resolve());
    stream.once("error", reject);
    stream.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });

  return {
    ok: true,
    image: { id, name: filename, contentType: check.contentType, size: bytes.length, uploadedAt: new Date() },
  };
}

/** Metadata of one upload; null for unknown ids (and anything that isn't an image we stored). */
export async function findImage(id: string): Promise<StoredImage | null> {
  if (!isPlausibleFileId(id)) return null;
  const { files } = await open();
  const doc = await files.findOne({ _id: id });
  return doc ? toStoredImage(doc) : null;
}

/** The file's bytes as a Node stream. Call findImage() first to make sure it exists. */
export async function openImageStream(id: string): Promise<Readable> {
  const { bucket } = await open();
  return bucket.openDownloadStream(gridId(id));
}

/** Newest uploads first. */
export async function listRecentImages(limit = 24): Promise<StoredImage[]> {
  const { files } = await open();
  const docs = await files
    .find({})
    .sort({ uploadDate: -1, _id: 1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .toArray();
  return docs.map(toStoredImage).filter((image): image is StoredImage => image !== null);
}

/** Delete an upload and its chunks. False when it didn't exist. */
export async function deleteImage(id: string): Promise<boolean> {
  if (!isPlausibleFileId(id)) return false;
  const { bucket, files } = await open();
  if ((await files.countDocuments({ _id: id }, { limit: 1 })) === 0) return false;
  try {
    await bucket.delete(gridId(id));
    return true;
  } catch {
    // Deleted by someone else in the meantime.
    return false;
  }
}
