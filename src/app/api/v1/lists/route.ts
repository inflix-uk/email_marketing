import type { NextRequest } from "next/server";
import { getApiLists } from "@/lib/api/contacts";
import { apiJson, authenticate, handleApi } from "@/lib/api/http";

/** GET /api/v1/lists - every list (id + name), for use in POST /api/v1/contacts. */
export function GET(request: NextRequest) {
  return handleApi(async () => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    return apiJson({ lists: await getApiLists() });
  });
}
