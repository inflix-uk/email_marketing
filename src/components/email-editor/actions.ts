"use server";

import { requireSession } from "@/lib/auth";
import { IMAGE_EMPTY_ERROR, IMAGE_SIZE_ERROR, MAX_IMAGE_BYTES } from "@/lib/files/image-type";
import { deleteImage, imagePath, imageUrl, listRecentImages, saveImage, type StoredImage } from "@/lib/files/uploads";
import { getSettings } from "@/lib/settings";

// Server actions behind the visual editor's image picker. They live next to
// the editor (not a page) because the editor is shared by templates,
// campaigns and automations.

export interface EditorImage {
  id: string;
  name: string;
  /** Absolute URL (settings.appUrl) - this is what goes into the email. */
  url: string;
  /** Same file relative to this app, for thumbnails in the editor. */
  path: string;
  size: number;
}

export type UploadImageResult = { ok: true; image: EditorImage } | { ok: false; error: string };

function toEditorImage(image: StoredImage, appUrl: string): EditorImage {
  return {
    id: image.id,
    name: image.name,
    url: imageUrl(appUrl, image.id),
    path: imagePath(image.id),
    size: image.size,
  };
}

/** Store the image in the form field "file". PNG, JPEG, GIF or WebP, up to 2 MB. */
export async function uploadEditorImage(formData: FormData): Promise<UploadImageResult> {
  const session = await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: IMAGE_EMPTY_ERROR };
  // Checked before reading the file into memory; saveImage() checks the real bytes again.
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: IMAGE_SIZE_ERROR };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [result, settings] = await Promise.all([saveImage(bytes, file.name, session.email), getSettings()]);
    if (!result.ok) return result;
    return { ok: true, image: toEditorImage(result.image, settings.appUrl) };
  } catch (err) {
    console.error("[files] upload failed", err);
    return { ok: false, error: "The image couldn't be saved. Please try again." };
  }
}

/** The newest uploads, for the "Recent images" grid. */
export async function listEditorImages(): Promise<EditorImage[]> {
  await requireSession();
  const [images, settings] = await Promise.all([listRecentImages(24), getSettings()]);
  return images.map((image) => toEditorImage(image, settings.appUrl));
}

/** Delete an upload. Emails that already use it will show a broken image. */
export async function deleteEditorImage(id: string): Promise<{ ok: boolean }> {
  await requireSession();
  if (typeof id !== "string") return { ok: false };
  return { ok: await deleteImage(id) };
}
