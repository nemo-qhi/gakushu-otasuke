import { createSyncSpace, syncErrorResponse } from "@/lib/sync-store";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      clientId?: string;
      data?: Record<string, unknown>;
    };

    const result = await createSyncSpace({
      clientId: payload.clientId,
      data: payload.data ?? {},
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return syncErrorResponse(error);
  }
}
