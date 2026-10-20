import { BLANK_VISUAL_STARTER } from "@/lib/templates/starters";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { createTemplate } from "./actions";
import { PasteHtmlCard } from "./paste-html";
import { StarterCard } from "./starter-card";

// The ready-made designs, "Blank" (an empty design in the visual editor) and "Paste HTML".
const CHOICES: { key: string; name: string; html: string | null }[] = [
  { key: BLANK_VISUAL_STARTER.key, name: "Blank", html: null },
  ...STARTER_TEMPLATES.map((starter) => ({ key: starter.key, name: starter.name, html: starter.html })),
];

/** Design cards: one click creates the template and opens the editor. */
export function StarterPicker() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {CHOICES.map((choice) => (
        <li key={choice.key}>
          <form action={createTemplate} className="h-full">
            <input type="hidden" name="starter" value={choice.key} />
            <StarterCard name={choice.name} html={choice.html} />
          </form>
        </li>
      ))}
      <li>
        <PasteHtmlCard />
      </li>
    </ul>
  );
}
