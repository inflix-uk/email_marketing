import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function FormNotFound() {
  return (
    <EmptyState
      title="Form not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/forms">Back to forms</ButtonLink>}
    />
  );
}
