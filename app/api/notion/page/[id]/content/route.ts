import { blockTitle, notionErrorResponse, notionFetch, tokenFromRequest } from "@/lib/notion";
import type { NotionBlock } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const { searchParams } = new URL(request.url);
    const depthParam = searchParams.get("depth");
    const maxDepth = depthParam === "All" || !depthParam ? 20 : Number(depthParam);

    const blocks = await getChildren(token, params.id, 0, maxDepth);
    return Response.json({ results: blocks });
  } catch (error) {
    return notionErrorResponse(error);
  }
}

async function getChildren(token: string, blockId: string, depth: number, maxDepth: number): Promise<NotionBlock[]> {
  if (depth >= maxDepth) return [];
  const blocks: NotionBlock[] = [];
  let start_cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (start_cursor) qs.set("start_cursor", start_cursor);
    const body: any = await notionFetch(token, `/blocks/${blockId}/children?${qs.toString()}`);
    for (const block of body.results) {
      if (block.has_children && (depth + 1 < maxDepth)) {
        block.children = await getChildren(token, block.id, depth + 1, maxDepth);
      }
      
      // Filter out truly empty blocks
      const title = blockTitle(block);
      const hasChildren = block.children && block.children.length > 0;
      const isStructure = ["child_page", "child_database"].includes(block.type);
      
      if (title || hasChildren || isStructure) {
        blocks.push(block);
      }
    }
    start_cursor = body.has_more ? body.next_cursor : undefined;
  } while (start_cursor);
  return blocks;
}
