import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function TemplateNotFound() {
  return (
    <EmptyState
      title="Template not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/templates">Back to templates</ButtonLink>}
    />
  );
}
