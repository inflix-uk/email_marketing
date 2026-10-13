import type { FormField } from "@/db/schema";
import { escapeHtml } from "@/lib/render";
import { HONEYPOT_FIELD } from "./validation";

// Copy-paste code for putting a form on another website. Pure.

export interface SnippetForm {
  id: string;
  title: string;
  buttonText: string;
  fields: FormField[];
}

export function hostedFormUrl(appUrl: string, formId: string): string {
  return `${appUrl}/f/${formId}`;
}

export function subscribeEndpoint(appUrl: string, formId: string): string {
  return `${appUrl}/api/subscribe/${formId}`;
}

/** A plain HTML form (no JavaScript) that posts to the subscribe endpoint. */
export function htmlEmbedSnippet(appUrl: string, form: SnippetForm): string {
  const lines = [
    `<form action="${escapeHtml(subscribeEndpoint(appUrl, form.id))}" method="post">`,
    `  <label>Email <input type="email" name="email" required></label>`,
    ...form.fields.map(
      (f) =>
        `  <label>${escapeHtml(f.label)} <input type="text" name="${escapeHtml(f.key)}"${f.required ? " required" : ""}></label>`,
    ),
    `  <!-- Spam trap: leave this hidden field as it is -->`,
    `  <input type="text" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">`,
    `  <button type="submit">${escapeHtml(form.buttonText)}</button>`,
    `</form>`,
  ];
  return lines.join("\n");
}

/** The hosted page inside an iframe. */
export function iframeSnippet(appUrl: string, form: SnippetForm): string {
  const height = 300 + form.fields.length * 70;
  return `<iframe src="${escapeHtml(hostedFormUrl(appUrl, form.id))}?embed=1" title="${escapeHtml(form.title)}" width="100%" height="${height}" style="border:0;max-width:480px" loading="lazy"></iframe>`;
}
