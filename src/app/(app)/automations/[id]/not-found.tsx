import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function AutomationNotFound() {
  return (
    <EmptyState
      title="Automation not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/automations">Back to automations</ButtonLink>}
    />
  );
}
