import type { ReactNode } from "react";
import { Card } from "@/components/ui/layout";

/** Centered card with the logo: shared by the sign-in, forgot-password and reset-password pages. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Small links under the card. */
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 font-bold text-white">I</span>
          <span className="text-lg font-semibold text-slate-900">Inflix Marketing</span>
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          <div className="mt-4">{children}</div>
        </Card>
        {footer ? <div className="mt-4 text-center text-sm text-slate-500">{footer}</div> : null}
      </div>
    </div>
  );
}
