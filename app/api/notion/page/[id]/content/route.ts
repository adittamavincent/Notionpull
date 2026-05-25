import { notionErrorResponse, notionFetch, tokenFromRequest } from "@/lib/notion";
import type { NotionBlock } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const blocks = await getChildren(token, params.id, 0);
    return Response.json({ results: blocks });
  } catch (error) {
    return notionErrorResponse(error);
  }
}

async function getChildren(token: string, blockId: string, depth: number): Promise<NotionBlock[]> {
  if (depth > 20) return [];
  const blocks: NotionBlock[] = [];
  let start_cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (start_cursor) qs.set("start_cursor", start_cursor);
    const body: any = await notionFetch(token, `/blocks/${blockId}/children?${qs.toString()}`);
    for (const block of body.results) {
      if (block.has_children) block.children = await getChildren(token, block.id, depth + 1);
      blocks.push(block);
    }
    start_cursor = body.has_more ? body.next_cursor : undefined;
  } while (start_cursor);
  return blocks;
}
