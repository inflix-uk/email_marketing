import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { SuppressForm } from "./suppress-form";

export const metadata: Metadata = { title: "Suppress addresses" };

export default function SuppressPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Suppress addresses"
        description="Paste addresses that must never be emailed - for example people who opted out elsewhere or asked by phone."
        back={
          <Link href="/contacts" className="text-slate-500 hover:text-slate-700">
            &larr; Contacts
          </Link>
        }
      />
      <Card>
        <CardHeader
          title="Addresses to suppress"
          description="Existing contacts are unsubscribed. Unknown addresses are saved as unsubscribed, so a later import can't subscribe them."
        />
        <CardBody>
          <SuppressForm />
        </CardBody>
      </Card>
    </div>
  );
}
