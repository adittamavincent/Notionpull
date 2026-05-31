import { blockTitle, databaseTitle, pageTitle, notionErrorResponse, notionFetch, NotionApiError, traceChild, tokenFromRequest } from "@/lib/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const blocks: any[] = [];
    let start_cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: "100" });
      if (start_cursor) qs.set("start_cursor", start_cursor);
      const body: any = await notionFetch(token, `/blocks/${params.id}/children?${qs.toString()}`, {}, { tracePath: traceChild(`page-children/${params.id}`, "children") });
      blocks.push(...body.results);
      start_cursor = body.has_more ? body.next_cursor : undefined;
    } while (start_cursor);

    // Resolve link_to_page blocks in parallel
    const linkToPageBlocks = blocks.filter((block) => block.type === "link_to_page");
    const resolvedLinks = new Map<string, { targetId: string; targetType: "database" | "page"; title: string; dataSourceName?: string }>();

    if (linkToPageBlocks.length > 0) {
      await Promise.allSettled(
        linkToPageBlocks.map(async (block) => {
          const link = block.link_to_page;
          if (!link) return;
          const targetType = link.type === "database_id" ? "database" : (link.type === "page_id" ? "page" : null);
          if (!targetType) return;
          const targetId = link.type === "database_id" ? link.database_id : link.page_id;
          if (!targetId) return;

          try {
            if (targetType === "database") {
              try {
                const db = await notionFetch<any>(token, `/databases/${targetId}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `link-database/${targetId}`) });
                const actualDbId = db.data_sources?.[0]?.id ?? targetId;
                resolvedLinks.set(block.id, {
                  targetId: actualDbId,
                  targetType: "database",
                  title: databaseTitle(db),
                  dataSourceName: db.data_sources?.[0]?.name
                });
              } catch (dbErr: any) {
                // If it's actually a page, fallback to fetching as page
                if (dbErr instanceof NotionApiError && (dbErr.status === 404 || dbErr.status === 400 || /is a page/i.test(dbErr.message))) {
                  const pg = await notionFetch<any>(token, `/pages/${targetId}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `link-page/${targetId}`) });
                  resolvedLinks.set(block.id, {
                    targetId,
                    targetType: "page",
                    title: pageTitle(pg)
                  });
                } else {
                  throw dbErr;
                }
              }
            } else {
              try {
                const pg = await notionFetch<any>(token, `/pages/${targetId}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `link-page/${targetId}`) });
                resolvedLinks.set(block.id, {
                  targetId,
                  targetType: "page",
                  title: pageTitle(pg)
                });
              } catch (pgErr: any) {
                // If it's actually a database, fallback to fetching as database
                if (pgErr instanceof NotionApiError && (pgErr.status === 404 || pgErr.status === 400 || /is a database/i.test(pgErr.message))) {
                  const db = await notionFetch<any>(token, `/databases/${targetId}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `link-database/${targetId}`) });
                  resolvedLinks.set(block.id, {
                    targetId: db.data_sources?.[0]?.id ?? targetId,
                    targetType: "database",
                    title: databaseTitle(db),
                    dataSourceName: db.data_sources?.[0]?.name
                  });
                } else {
                  throw pgErr;
                }
              }
            }
          } catch {
            resolvedLinks.set(block.id, {
              targetId,
              targetType: targetType === "database" ? "database" : "page",
              title: targetType === "database" ? "Untitled database" : "Untitled page"
            });
          }
        })
      );
    }

    return Response.json({
      results: blocks
        .map((block) => {
          let type = block.type === "child_page" ? "page" : (block.type === "child_database" ? "database" : "block");
          let id = block.id;
          let title = blockTitle(block);
          let hasChildren = block.has_children;

          let dataSourceName: string | undefined = undefined;

          if (block.type === "link_to_page") {
            const resolved = resolvedLinks.get(block.id);
            if (resolved) {
              type = resolved.targetType;
              id = resolved.targetId;
              title = resolved.title;
              dataSourceName = resolved.dataSourceName;
              hasChildren = resolved.targetType === "database" ? true : block.has_children;
            }
          }

          const dbMentionId = findDatabaseMentionId(block);
          if (dbMentionId) {
            type = "database";
            id = dbMentionId;
            hasChildren = true;
          }

          return {
            id,
            type,
            kind: dbMentionId ? "database" : block.type,
            title,
            hasChildren,
            dataSourceName
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
          if (["divider", "image", "video", "file", "pdf", "equation", "table", "table_row"].includes(node.kind)) return true;
          
          return false;
        })
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
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
