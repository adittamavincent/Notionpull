import { notionErrorResponse, notionFetch, tokenFromRequest } from "@/lib/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const cursor = new URL(request.url).searchParams.get("cursor");
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const rows = await notionFetch(token, `/data_sources/${params.id}/query`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    return Response.json(rows);
  } catch (error) {
    return notionErrorResponse(error);
  }
}
