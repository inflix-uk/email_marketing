import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { listApiKeys } from "@/lib/api/keys";
import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { CopyBox } from "../../forms/copy-box";
import { revokeApiKeyAction } from "./actions";
import { CreateKeyForm, RevokeKeyButton } from "./api-keys";

export const metadata: Metadata = { title: "API" };

export default async function ApiSettingsPage() {
  await requireSession();
  const [keys, settings] = await Promise.all([listApiKeys(), getSettings()]);
  const base = `${settings.appUrl.replace(/\/+$/, "")}/api/v1`;
  const auth = `-H "Authorization: Bearer YOUR_API_KEY"`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="API"
        description="Add and update contacts from your own website or app."
        back={
          <Link href="/settings" className="text-slate-500 hover:text-slate-700">
            &larr; Settings
          </Link>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="API keys" description="A key gives full access to the API - keep it secret and use it only on a server." />
          <CardBody>
            <CreateKeyForm />
          </CardBody>
          {keys.length > 0 ? (
            <div className="border-t border-slate-200">
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Name</Th>
                    <Th>Key</Th>
                    <Th className="hidden sm:table-cell">Created</Th>
                    <Th className="hidden sm:table-cell">Last used</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <TBody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <Td className="font-medium text-slate-900">{key.name}</Td>
                      <Td className="whitespace-nowrap font-mono text-xs">{key.prefix}...</Td>
                      <Td className="hidden whitespace-nowrap text-slate-500 sm:table-cell">{formatDate(key.createdAt)}</Td>
                      <Td className="hidden whitespace-nowrap text-slate-500 sm:table-cell">
                        {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "Never"}
                      </Td>
                      <Td className="text-right">
                        <RevokeKeyButton action={revokeApiKeyAction.bind(null, key.id)} name={key.name} />
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="How to use it" description="Send your key in the Authorization header. Requests and answers are JSON." />
          <CardBody className="space-y-6">
            <div className="space-y-1.5">
              <CopyBox
                label="Add or update a contact"
                multiline
                value={[
                  `curl -X POST ${base}/contacts \\`,
                  `  ${auth} \\`,
                  `  -H "Content-Type: application/json" \\`,
                  `  -d '{"email":"jane@example.com","first_name":"Jane","last_name":"Doe","fields":{"company":"Acme"},"tags":["customer"],"lists":["Newsletter"]}'`,
                ].join("\n")}
              />
              <p className="text-xs text-slate-500">
                Only <code className="font-mono">email</code> is required. <code className="font-mono">lists</code> takes list names or ids.
                New contacts are subscribed. An existing contact is updated and keeps its status, so someone who unsubscribed is never
                re-subscribed.
              </p>
            </div>
            <CopyBox label="Look up a contact" multiline value={`curl "${base}/contacts?email=jane@example.com" \\\n  ${auth}`} />
            <CopyBox label="Get your lists" multiline value={`curl ${base}/lists \\\n  ${auth}`} />
            <p className="text-xs text-slate-500">
              Errors look like <code className="font-mono">{`{"error":{"code":"...","message":"..."}}`}</code> with status 400 / 422 (bad
              request), 401 (wrong key), 404 (not found) or 429 (more than 120 requests a minute).
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
