import type { NextRequest } from "next/server";
import { apiContactSchema, findApiContact, firstIssueMessage, upsertApiContact } from "@/lib/api/contacts";
import { apiError, apiJson, authenticate, handleApi, readJsonObject } from "@/lib/api/http";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

// Public REST API, authenticated with `Authorization: Bearer <API key>`
// (keys are created on /settings/api). See src/proxy.ts.

/** GET /api/v1/contacts?email=jane@example.com - one contact by email. */
export function GET(request: NextRequest) {
  return handleApi(async () => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const email = request.nextUrl.searchParams.get("email") ?? "";
    if (!email.trim()) return apiError(400, "missing_email", "Add the email query parameter, e.g. ?email=jane@example.com");
    if (email.length > 254 || !isValidEmail(email)) return apiError(422, "invalid_email", "That is not a valid email address.");

    const contact = await findApiContact(normalizeEmail(email));
    if (!contact) return apiError(404, "not_found", "No contact has this email address.");
    return apiJson({ contact });
  });
}

/** POST /api/v1/contacts - create the contact, or update it when the email is already known. */
export function POST(request: NextRequest) {
  return handleApi(async () => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonObject(request);
    if (!body.ok) return body.response;

    const parsed = apiContactSchema.safeParse(body.body);
    if (!parsed.success) return apiError(422, "invalid_request", firstIssueMessage(parsed.error));

    const result = await upsertApiContact(parsed.data);
    if (!result.ok) return apiError(422, result.code, result.message);
    return apiJson({ contact: result.contact, created: result.created }, result.created ? 201 : 200);
  });
}
