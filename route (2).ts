import { syncErrorResponse, syncSpace } from "@/lib/sync-store";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      code?: string;
      clientId?: string;
      data?: Record<string, unknown>;
      baseRevision?: number;
      idempotencyKey?: string;
    };

    const result = await syncSpace({
      code: payload.code ?? "",
      clientId: payload.clientId,
      data: payload.data ?? {},
      baseRevision: payload.baseRevision,
      idempotencyKey: payload.idempotencyKey,
    });

    return Response.json(result);
  } catch (error) {
    return syncErrorResponse(error);
  }
}
