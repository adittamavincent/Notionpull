import { blockTitle, databaseTitle, pageTitle, notionErrorResponse, notionFetch, NotionApiError, traceChild, tokenFromRequest, resolveDatabaseActualTitle } from "@/lib/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const { searchParams } = new URL(request.url);
    const fetchComments = searchParams.get("comments") === "true";
    // resolveLinkedTitles: for each child_database / link_to_page block, fetch the
    // canonical data_source title via views + data_sources endpoints (2–3 extra calls each).
    // Off by default to keep tree expansion fast.
    const resolveLinkedTitles = searchParams.get("resolveLinkedTitles") === "true";

    if (fetchComments) {
      try {
        await notionFetch(token, `/comments?block_id=${params.id}`, {}, { tracePath: traceChild(`page-children/${params.id}`, "comments") });
      } catch { }
    }

    const blocks: any[] = [];
    let start_cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: "100" });
      if (start_cursor) qs.set("start_cursor", start_cursor);
      const body: any = await notionFetch(token, `/blocks/${params.id}/children?${qs.toString()}`, {}, { tracePath: traceChild(`page-children/${params.id}`, "children") });
      blocks.push(...body.results);
      start_cursor = body.has_more ? body.next_cursor : undefined;
    } while (start_cursor);

    if (fetchComments) {
      // Background fetch comments for child blocks
      blocks.forEach((block) => {
        notionFetch(token, `/comments?block_id=${block.id}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `block-comments/${block.id}`) }).catch(() => {});
      });
    }

    // Resolve link_to_page and child_database blocks in parallel
    const linkToPageBlocks = blocks.filter((block) => block.type === "link_to_page");
    const childDbBlocks = blocks.filter((block) => block.type === "child_database");
    const resolvedLinks = new Map<string, { targetId: string; targetType: "database" | "page"; title: string; dataSourceName?: string; isLinkedDatabase?: boolean }>();
    const resolvedDbs = new Map<string, { title: string; dataSourceName?: string; isLinkedDatabase?: boolean }>();
    const promises: Promise<any>[] = [];

    if (linkToPageBlocks.length > 0) {
      promises.push(...linkToPageBlocks.map(async (block) => {
        const link = block.link_to_page;
        if (!link) return;
        const targetType = link.type === "database_id" ? "database" : (link.type === "page_id" ? "page" : null);
        if (!targetType) return;
        const targetId = link.type === "database_id" ? link.database_id : link.page_id;
        if (!targetId) return;

        try {
          if (targetType === "database") {
            const db = await notionFetch<any>(token, `/databases/${targetId}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `link-database/${targetId}`) });
            let title = db.title?.map((t: any) => t.plain_text || "").join("").trim() || "Untitled database";
            let dataSourceName: string | undefined;
            let actualDbId = targetId;
            let isLinkedDb = false;
            if (resolveLinkedTitles) {
              const actualInfo = await resolveDatabaseActualTitle(token, db, `page-children/${params.id}`);
              actualDbId = actualInfo.dataSourceId ?? targetId;
              title = actualInfo.title;
              dataSourceName = actualInfo.dataSourceName;
              isLinkedDb = !!actualInfo.dataSourceId && actualInfo.dataSourceId !== targetId;
            } else {
              const dsId = db.data_sources?.[0]?.id;
              if (dsId && dsId !== targetId) {
                actualDbId = dsId;
                isLinkedDb = true;
              }
            }
            resolvedLinks.set(block.id, {
              targetId: actualDbId,
              targetType: "database",
              title,
              dataSourceName,
              isLinkedDatabase: isLinkedDb
            });
          } else {
            const pg = await notionFetch<any>(token, `/pages/${targetId}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `link-page/${targetId}`) });
            resolvedLinks.set(block.id, {
              targetId,
              targetType: "page",
              title: pageTitle(pg)
            });
          }
        } catch {
          resolvedLinks.set(block.id, {
            targetId,
            targetType: targetType === "database" ? "database" : "page",
            title: targetType === "database" ? "Untitled database" : "Untitled page"
          });
        }
      }));
    }

    if (childDbBlocks.length > 0) {
      promises.push(...childDbBlocks.map(async (block) => {
        try {
          const db = await notionFetch<any>(token, `/databases/${block.id}`, {}, { tracePath: traceChild(`page-children/${params.id}`, `database/${block.id}`) });
          let title = db.title?.map((t: any) => t.plain_text || "").join("").trim() || "Untitled database";
          let dataSourceName: string | undefined;
          let isLinkedDb = false;
          if (resolveLinkedTitles) {
            const actualInfo = await resolveDatabaseActualTitle(token, db, `page-children/${params.id}`);
            title = actualInfo.title;
            dataSourceName = actualInfo.dataSourceName;
            isLinkedDb = !!actualInfo.dataSourceId && actualInfo.dataSourceId !== block.id;
          } else {
            const dsId = db.data_sources?.[0]?.id;
            if (dsId && dsId !== block.id) isLinkedDb = true;
          }
          resolvedDbs.set(block.id, { title, dataSourceName, isLinkedDatabase: isLinkedDb });
        } catch { }
      }));
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    return Response.json({
      results: blocks
        .map((block) => {
          let type = block.type === "child_page" ? "page" : (block.type === "child_database" ? "database" : "block");
          let id = block.id;
          let title = blockTitle(block);
          let hasChildren = block.has_children;

          let dataSourceName: string | undefined = undefined;
          let isLinkedDatabase: boolean | undefined = undefined;

          if (block.type === "link_to_page") {
            const resolved = resolvedLinks.get(block.id);
            if (resolved) {
              type = resolved.targetType;
              id = resolved.targetId;
              title = resolved.title;
              dataSourceName = resolved.dataSourceName;
              hasChildren = resolved.targetType === "database" ? true : block.has_children;
              isLinkedDatabase = resolved.isLinkedDatabase;
            }
          }

          if (block.type === "child_database") {
            const resolved = resolvedDbs.get(block.id);
            if (resolved) {
              title = resolved.title;
              dataSourceName = resolved.dataSourceName;
              isLinkedDatabase = resolved.isLinkedDatabase;
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
            dataSourceName,
            isLinkedDatabase
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
