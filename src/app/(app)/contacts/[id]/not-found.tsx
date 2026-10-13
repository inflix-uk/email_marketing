import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function ContactNotFound() {
  return (
    <EmptyState
      title="Contact not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/contacts">Back to contacts</ButtonLink>}
    />
  );
}
