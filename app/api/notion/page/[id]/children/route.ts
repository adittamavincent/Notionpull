import { blockTitle, notionErrorResponse, notionFetch, tokenFromRequest } from "@/lib/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const blocks: any[] = [];
    let start_cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: "100" });
      if (start_cursor) qs.set("start_cursor", start_cursor);
      const body: any = await notionFetch(token, `/blocks/${params.id}/children?${qs.toString()}`);
      blocks.push(...body.results);
      start_cursor = body.has_more ? body.next_cursor : undefined;
    } while (start_cursor);

    return Response.json({
      results: blocks.map((block) => ({
        id: block.id,
        type: block.type === "child_page" ? "page" : (block.type === "child_database" ? "database" : "block"),
        kind: block.type,
        title: blockTitle(block),
        hasChildren: block.has_children
      }))
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
