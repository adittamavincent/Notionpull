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
      results: blocks
        .map((block) => {
          const type = block.type === "child_page" ? "page" : (block.type === "child_database" ? "database" : "block");
          const title = blockTitle(block);
          return {
            id: block.id,
            type,
            kind: block.type,
            title,
            hasChildren: block.has_children
          };
        })
        .filter((node) => {
          // Always keep pages and databases
          if (node.type !== "block") return true;
          // Keep blocks that have text content
          if (node.title) return true;
          // Keep blocks that have children (even if they have no text themselves, they contain things)
          if (node.hasChildren) return true;
          // Keep special visual blocks
          if (["divider", "image", "video", "file", "pdf", "equation"].includes(node.kind)) return true;
          
          return false;
        })
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
