"use client";

// Shared email editing & preview components (used by templates and campaigns).
//
//   <EmailEditor name="html" defaultValue={html} previewText={previewText} />
//     Code editor + live preview + lint checks; submits its HTML through a
//     hidden <input name="html"> so it works inside any <form>.
//
//   <EmailPreview html={html} width="mobile" height={600} />
//     Sandboxed, read-only preview with merge tags filled from SAMPLE_CONTACT.
//
//   <EmailThumbnail html={html} className="aspect-[4/3]" />
//     Small, non-interactive snapshot for cards.

export { EmailEditor, type EmailEditorProps } from "./editor";
export { EmailPreview, EmailThumbnail, type EmailPreviewProps } from "./preview";
