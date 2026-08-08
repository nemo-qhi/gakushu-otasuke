import { formatPersonalCode, openSyncSpace, syncErrorResponse } from "@/lib/sync-store";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      code?: string;
    };

    const code = payload.code ?? "";
    const snapshot = await openSyncSpace(code);

    return Response.json({
      code: formatPersonalCode(code),
      ...snapshot,
    });
  } catch (error) {
    return syncErrorResponse(error);
  }
}
