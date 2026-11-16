import Link from "next/link";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import type { Form } from "@/db/schema";
import { hostedFormUrl, htmlEmbedSnippet, subscribeEndpoint } from "@/lib/forms/snippets";
import { formatNumber } from "@/lib/utils";
import { CopyBox } from "../../forms/copy-box";
import { connectSignupAction, setSignupActiveAction } from "../actions";

// "Website sign-up" box on a list's page: connect once, then copy a link, a
// ready-made form, or the address a web developer sends sign-ups to.

function isLocalAddress(appUrl: string): boolean {
  try {
    const host = new URL(appUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return true;
  }
}

export function WebsiteSignup({
  listId,
  form,
  appUrl,
  canEdit,
  className,
}: {
  listId: string;
  form: Form | null;
  appUrl: string;
  canEdit: boolean;
  className?: string;
}) {
  if (!form) {
    return (
      <Card className={className}>
        <CardHeader title="Website sign-up" />
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            People who sign up on your website are added to this list straight away, with their name and email.
          </p>
          {canEdit ? (
            <form action={connectSignupAction.bind(null, listId)}>
              <SubmitButton variant="secondary" pendingText="Connecting...">
                Connect website sign-up
              </SubmitButton>
            </form>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  const endpoint = subscribeEndpoint(appUrl, form.id);
  const developerNote = [
    `POST ${endpoint}`,
    "Content-Type: application/json",
    "",
    `{ "email": "jane@example.com", "first_name": "Jane" }`,
  ].join("\n");

  return (
    <Card className={className}>
      <CardHeader
        title="Website sign-up"
        description={
          form.active
            ? `On · ${formatNumber(form.submissions)} ${form.submissions === 1 ? "sign-up" : "sign-ups"} so far`
            : "Paused - new sign-ups are refused"
        }
      />
      <CardBody className="space-y-4">
        {isLocalAddress(appUrl) ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            These links use {appUrl}, which your website can&apos;t reach. Set the app&apos;s website address in{" "}
            <Link href="/settings" className="font-medium underline">
              Settings
            </Link>{" "}
            first.
          </p>
        ) : null}
        <CopyBox label="Sign-up page link" value={hostedFormUrl(appUrl, form.id)} />
        <CopyBox label="Form to paste into your website" value={htmlEmbedSnippet(appUrl, form)} multiline />
        <CopyBox label="For your web developer" value={developerNote} multiline />
        <p className="text-xs text-slate-500">
          Anyone who unsubscribed before is never subscribed again by a sign-up.
        </p>
        {canEdit ? (
          <form action={setSignupActiveAction.bind(null, listId, form.id, !form.active)}>
            <SubmitButton variant="ghost" size="sm" pendingText={form.active ? "Pausing..." : "Turning on..."}>
              {form.active ? "Pause sign-ups" : "Turn sign-ups back on"}
            </SubmitButton>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
