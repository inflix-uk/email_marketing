"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { IMAGE_ACCEPT, IMAGE_SIZE_ERROR, IMAGE_TYPE_ERROR, isImageContentType, MAX_IMAGE_BYTES } from "@/lib/files/image-type";
import { cn } from "@/lib/utils";
import { deleteEditorImage, listEditorImages, uploadEditorImage, type EditorImage } from "./actions";
import { ConfirmDialog } from "./controls";

// Image choice for the visual editor: upload a file, or pick one of the
// recent uploads. Uploads are stored by the server (see ./actions) and
// inserted into the email by their absolute URL.

const UPLOAD_FAILED = "The upload didn't go through. Check your connection and that the file is under 2 MB, then try again.";

type LibraryStatus = "idle" | "loading" | "ready" | "error";

interface ImageLibrary {
  images: EditorImage[];
  status: LibraryStatus;
  /** Load the recent uploads once (no-op afterwards). */
  load: () => void;
  upload: (file: File) => Promise<{ ok: true; image: EditorImage } | { ok: false; error: string }>;
  remove: (id: string) => Promise<boolean>;
}

const ImageLibraryContext = createContext<ImageLibrary | null>(null);

/** Shares the list of recent uploads between all image blocks of one editor. */
export function ImageLibraryProvider({ children }: { children: ReactNode }) {
  const [images, setImages] = useState<EditorImage[]>([]);
  const [status, setStatus] = useState<LibraryStatus>("idle");
  const started = useRef(false);

  const load = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setStatus("loading");
    listEditorImages().then(
      (loaded) => {
        // Keep anything uploaded while the list was loading.
        setImages((current) => [...current, ...loaded.filter((image) => !current.some((c) => c.id === image.id))]);
        setStatus("ready");
      },
      () => {
        started.current = false;
        setStatus("error");
      },
    );
  }, []);

  const upload = useCallback<ImageLibrary["upload"]>(async (file) => {
    // Quick checks before sending anything; the server verifies the real bytes.
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: IMAGE_SIZE_ERROR };
    if (file.type && !isImageContentType(file.type)) return { ok: false, error: IMAGE_TYPE_ERROR };
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadEditorImage(formData);
      if (result?.ok) setImages((current) => [result.image, ...current.filter((image) => image.id !== result.image.id)]);
      return result ?? { ok: false, error: UPLOAD_FAILED };
    } catch {
      return { ok: false, error: UPLOAD_FAILED };
    }
  }, []);

  const remove = useCallback<ImageLibrary["remove"]>(async (id) => {
    try {
      await deleteEditorImage(id);
      // Gone either way (deleted now, or already deleted elsewhere).
      setImages((current) => current.filter((image) => image.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(() => ({ images, status, load, upload, remove }), [images, status, load, upload, remove]);
  return <ImageLibraryContext.Provider value={value}>{children}</ImageLibraryContext.Provider>;
}

function useImageLibrary(): ImageLibrary {
  const library = useContext(ImageLibraryContext);
  if (!library) throw new Error("ImagePicker must be used inside an ImageLibraryProvider");
  return library;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Upload button + "Recent images" grid. `value` is the image URL currently
 * used by the block; `onPick` receives the absolute URL of the chosen image
 * ("" when the image in use was deleted).
 */
export function ImagePicker({ value, onPick }: { value: string; onPick: (url: string, image: EditorImage | null) => void }) {
  const { images, status, load, upload, remove } = useImageLibrary();

  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EditorImage | null>(null);

  // Uploads and deletes finish later: report to the newest `onPick` (the block
  // may have been edited meanwhile), and not at all once this picker is gone.
  const latestOnPick = useRef<typeof onPick | null>(null);
  useEffect(() => {
    latestOnPick.current = onPick;
    return () => {
      latestOnPick.current = null;
    };
  }, [onPick]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await upload(file);
    setBusy(false);
    if (result.ok) latestOnPick.current?.(result.image.url, result.image);
    else setError(result.error);
  }

  async function confirmDelete() {
    const image = deleting;
    setDeleting(null);
    if (!image) return;
    setError(null);
    if (!(await remove(image.id))) {
      setError("The image couldn't be deleted. Please try again.");
    } else if (value === image.url) {
      latestOnPick.current?.("", null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Uploading..." : "Upload image"}
        </Button>
        <span className="text-xs text-slate-500">PNG, JPEG, GIF or WebP, up to 2 MB</span>
        {/* No name: this input is never part of the host form's submission. */}
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          aria-label="Image file to upload"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // allow choosing the same file again
            void onFile(file);
          }}
        />
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 ring-1 ring-red-200 ring-inset" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <p id={`${uid}-recent`} className="text-xs font-medium text-slate-700">
          Recent images
        </p>
        {status === "loading" || status === "idle" ? (
          <p className="mt-1 text-xs text-slate-400">Loading...</p>
        ) : status === "error" ? (
          <p className="mt-1 text-xs text-slate-500">
            Your uploads couldn&apos;t be loaded.{" "}
            <button type="button" onClick={load} className="font-medium text-indigo-600 hover:text-indigo-500">
              Try again
            </button>
          </p>
        ) : images.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400">Nothing uploaded yet.</p>
        ) : (
          <ul aria-labelledby={`${uid}-recent`} className="mt-1.5 grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto p-0.5">
            {images.map((image) => {
              const selected = value === image.url;
              return (
                <li key={image.id} className="group relative">
                  <button
                    type="button"
                    aria-pressed={selected}
                    title={`${image.name} (${formatSize(image.size)})`}
                    onClick={() => onPick(image.url, image)}
                    className={cn(
                      "block aspect-square w-full overflow-hidden rounded bg-slate-100 ring-1 ring-slate-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600",
                      selected && "ring-2 ring-indigo-600",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by /api/files */}
                    <img src={image.path} alt={image.name} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${image.name}`}
                    title="Delete"
                    onClick={() => setDeleting(image)}
                    className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-slate-600 opacity-0 shadow ring-1 ring-slate-300 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-indigo-600 pointer-coarse:opacity-100"
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3 w-3" aria-hidden>
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this image?"
        confirmLabel="Delete image"
        tone="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      >
        <p>
          <span className="font-medium break-words text-slate-900">{deleting?.name}</span> will be permanently deleted.
        </p>
        <p>Emails that already use it - including ones you have sent - will show a broken image.</p>
      </ConfirmDialog>
    </div>
  );
}
