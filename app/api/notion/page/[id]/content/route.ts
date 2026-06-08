import { blockTitle, databaseTitle, pageTitle, notionErrorResponse, notionFetch, NotionApiError, traceChild, tokenFromRequest } from "@/lib/notion";
import type { NotionBlock } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const { searchParams } = new URL(request.url);
    const depthParam = searchParams.get("depth");
    const maxDepth = depthParam === "Surface" ? 0 : depthParam === "All" || !depthParam ? 20 : Number(depthParam);

    const blocks = await getChildren(token, params.id, 0, maxDepth, `page-content/${params.id}`);
    return Response.json({ results: blocks });
  } catch (error) {
    return notionErrorResponse(error);
  }
}

async function getChildren(token: string, blockId: string, depth: number, maxDepth: number, traceRoot: string): Promise<NotionBlock[]> {
  if (depth >= maxDepth) return [];
  const blocks: NotionBlock[] = [];
  let start_cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (start_cursor) qs.set("start_cursor", start_cursor);
    const body: any = await notionFetch(token, `/blocks/${blockId}/children?${qs.toString()}`, {}, { tracePath: traceChild(traceRoot, "children") });

    // Resolve link_to_page blocks in parallel
    const linkToPageBlocks = body.results.filter((block: any) => block.type === "link_to_page");
    const resolvedLinks = new Map<string, { targetId: string; targetType: "child_database" | "child_page"; title: string }>();

    if (linkToPageBlocks.length > 0) {
      await Promise.allSettled(
        linkToPageBlocks.map(async (block: any) => {
          const link = block.link_to_page;
          if (!link) return;
          const targetType = link.type === "database_id" ? "child_database" : (link.type === "page_id" ? "child_page" : null);
          if (!targetType) return;
          const targetId = link.type === "database_id" ? link.database_id : link.page_id;
          if (!targetId) return;

          try {
            if (targetType === "child_database") {
              const db = await notionFetch<any>(token, `/databases/${targetId}`, {}, { tracePath: traceChild(traceRoot, `link-database/${targetId}`) });
              const actualDbId = db.data_sources?.[0]?.id ?? targetId;
              resolvedLinks.set(block.id, {
                targetId: actualDbId,
                targetType: "child_database",
                title: databaseTitle(db)
              });
            } else {
              const pg = await notionFetch<any>(token, `/pages/${targetId}`, {}, { tracePath: traceChild(traceRoot, `link-page/${targetId}`) });
              resolvedLinks.set(block.id, {
                targetId,
                targetType: "child_page",
                title: pageTitle(pg)
              });
            }
          } catch {
            resolvedLinks.set(block.id, {
              targetId,
              targetType: targetType === "child_database" ? "child_database" : "child_page",
              title: targetType === "child_database" ? "Untitled database" : "Untitled page"
            });
          }
        })
      );
    }

    for (let block of body.results) {
      if (block.type === "link_to_page") {
        const resolved = resolvedLinks.get(block.id);
        if (resolved) {
          block = {
            object: "block",
            id: resolved.targetId,
            parent: block.parent,
            created_time: block.created_time,
            last_edited_time: block.last_edited_time,
            created_by: block.created_by,
            last_edited_by: block.last_edited_by,
            has_children: resolved.targetType === "child_page" ? block.has_children : false,
            archived: block.archived,
            type: resolved.targetType,
            [resolved.targetType]: {
              title: resolved.title
            }
          } as any;
        }
      }

      const dbMentionId = findDatabaseMentionId(block);
      if (dbMentionId) {
        block = {
          object: "block",
          id: dbMentionId,
          parent: block.parent,
          created_time: block.created_time,
          last_edited_time: block.last_edited_time,
          created_by: block.created_by,
          last_edited_by: block.last_edited_by,
          has_children: false,
          archived: block.archived,
          type: "child_database",
          child_database: {
            title: blockTitle(block)
          }
        } as any;
      }

      if (block.has_children && (depth + 1 < maxDepth)) {
        block.children = await getChildren(token, block.id, depth + 1, maxDepth, traceChild(traceRoot, `child/${block.id}`));
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

function findDatabaseMentionId(block: any): string | null {
  const content = block[block.type];
  if (content && Array.isArray(content.rich_text)) {
    for (const part of content.rich_text) {
      if (part.type === "mention" && part.mention?.type === "database") {
        return part.mention.database?.id || null;
      }
    }
  }
  return null;
}
