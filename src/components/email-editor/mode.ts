import { BLANK_DESIGN, parseDesign, type EmailDesign } from "@/lib/email-design";

// Which editor an email opens in. Pure, so it can be unit-tested.

export type EditorMode =
  | {
      kind: "visual";
      design: EmailDesign;
      /** True when the design is a new blank one rather than saved content. */
      fresh: boolean;
    }
  | { kind: "html"; html: string };

/**
 * - a readable saved design            -> visual editor with that design
 * - no design, but there is HTML       -> HTML editor (hand-written HTML is never converted)
 * - a design this version can't read   -> HTML editor with the saved HTML, so nothing is lost
 * - nothing at all                     -> visual editor with a blank design
 */
export function initialMode(defaultValue: string, defaultDesign: string | null | undefined): EditorMode {
  const design = parseDesign(defaultDesign);
  if (design) return { kind: "visual", design, fresh: false };
  if (defaultValue.trim()) return { kind: "html", html: defaultValue };
  return { kind: "visual", design: BLANK_DESIGN, fresh: true };
}
