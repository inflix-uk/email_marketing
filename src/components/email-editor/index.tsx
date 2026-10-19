"use client";

// Shared email editing & preview components.
//
//   <EmailEditor name="html" defaultValue={html} designName="design" defaultDesign={design} />
//     Visual (block) editor with a live preview; can be switched to HTML code.
//     Submits the HTML through a hidden <input name="html"> and the design JSON
//     through <input name="design"> ("" once the email is hand-written HTML),
//     so it works inside any <form>. On the server: parseDesign() /
//     renderDesign() / serializeDesign() from "@/lib/email-design".
//     Without `designName` it is an HTML-only code editor.
//
//   <EmailPreview html={html} width="mobile" height={600} />
//     Sandboxed, read-only preview with merge tags filled from SAMPLE_CONTACT.
//
//   <EmailThumbnail html={html} className="aspect-[4/3]" />
//     Small, non-interactive snapshot for cards.

export { EmailEditor, type EmailEditorProps } from "./editor";
export { EmailPreview, EmailThumbnail, type EmailPreviewProps } from "./preview";
