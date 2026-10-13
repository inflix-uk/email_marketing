import type { Metadata } from "next";
import { UnsubscribeCard } from "../unsubscribe-card";

// Target of {{unsubscribe_url}} in previews and test sends, where there is no
// real recipient. Changes nothing; only the card's sender name comes from
// Settings (with a fallback when the database isn't set up).

export const metadata: Metadata = {
  title: { absolute: "Unsubscribe (preview)" },
  robots: { index: false, follow: false },
};

export default function UnsubscribePreviewPage() {
  return (
    <UnsubscribeCard title="Unsubscribe link preview">
      <p>
        This is the preview version of the unsubscribe link, used in previews and test emails. Nothing has been
        changed.
      </p>
      <p>
        In a real campaign email, each recipient gets a personal link that takes them to a page where they can
        unsubscribe with one click. Mail apps like Gmail and Apple Mail also show their own &quot;Unsubscribe&quot;
        button, which works the same way.
      </p>
    </UnsubscribeCard>
  );
}
