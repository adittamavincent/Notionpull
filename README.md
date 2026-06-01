# Notionpull

Next.js 14 App Router app for fetching shared Notion pages, databases, and data sources, then exporting selected content.

## Features

- **Finder-like Navigation:** Expandable list view for browsing nested Notion structures with intuitive icons.
- **Granular Database Exports:** Configure which columns to export for each database, complete with a live data preview. Database views are automatically detected from URLs to perfectly respect your configured property ordering, column visibility, and widths. Full column details (ordering, widths, and visibility) are perfectly preserved during database configurations and fully exported ready.
- **Simple Table Support:** Seamlessly detects, displays, and formats standard Notion simple tables into pristine Markdown tables, including granular selection of individual rows.
- **Smart Caching:** Local memory caching ensures that returning to a previously fetched depth level is instant. 
- **Recent URLs:** Quick access to recently fetched Notion URLs.
- **Export Progress:** Visual "building block" animation while fetching export data.
- **Color-Coded API Log Tracking:** raw API tracking debug modal classifies and dynamically applies harmonized premium colors (Blue for Databases, Purple for Data Sources, Emerald for Pages, etc.) directly to the log nameTags, showcasing synced data source context (e.g. Jira, GitHub connection status) transparently. Includes a premium one-click **Copy Logs** utility to instantly format and copy all surface-level API tracking logs to the clipboard.
- **Smart Targeted Detection:** Drastically reduces log noise and prevents unnecessary API requests (eliminating concurrent 404/400 errors) by using the universal `/blocks` endpoint as an initial type-discovery probe, falling back to sequential resolving or parsing granular Notion 400 error messages when needed.
- **Relation and Rollup Transparency:** Column types such as 'relation' and 'rollup' explicitly display both the reference title and its underlying Notion ID for precise relational mapping.
- **Recursive Property ID Traversal:** Automatically extracts and detects any Notion IDs found natively within database row properties (like plain text or rich text strings). When valid Notion IDs are identified inside property values (such as a 32-character compact ID string), they are dynamically resolved and seamlessly appended as navigable child elements in the Finder tree, ready to be recursively traversed and exported.
- **Resilient Type Validation:** Resilient to database vs. page type mismatches (such as mismatched type properties in `link_to_page` blocks), dynamically recovering target schema attributes on validation limits without raising 404/400 errors.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Notes

- Tokens stay in browser `localStorage` under `notion_tokens`.
- URL history stays in browser `localStorage` under `notionpull_history`.
- Browser never calls `api.notion.com`; all Notion calls use `/api/notion/*` route handlers.
- Notion API version is `2026-03-11`.
- Database rows use `POST /v1/databases/{id}/query` (full property data), falling back to `POST /v1/data_sources/{id}/query` for non-database data sources. The `data_sources` query endpoint returns sparse rows where URL, Files, and rich_text properties may appear empty even when they contain data.
- Notion ID parser extracts both 32-character compact IDs and 36-character standard UUIDs from any shared URL, preserving hyphen boundaries and safely ignoring preceding slugs.
- URL parsing automatically extracts view IDs (`?v=...`) and uses the Views API to perfectly mirror property order and column visibility defined in Notion database views. If no view ID is present, it automatically defaults to the primary database view. Because List Views responses are minimal by design (returning only ID references), each view is dynamically and resiliently retrieved in parallel. To support complex layout structures robustly, view configuration properties (column order, visibility, etc.) and titles are extracted using dynamic nesting detection to support both direct configuration fields and type-specific nested fields (such as `view.view.configuration` or `view.table.configuration`).
- Column definitions for empty databases (databases with zero rows/entries) are correctly resolved by falling back to the static database schema (`database.properties`) instead of returning empty properties.
- Database exports correctly include the full column list and structural schema metadata (including column names, types, options, and descriptions) even for empty databases with zero rows/entries.
- Block-level URL detection allows directly pasting block-level links (like table blocks) into the query input to fetch, traverse, and export their child elements.
- Simple tables (`table` and `table_row` blocks) are fully supported in exports, parsing individual row cells recursively and auto-generating standard Markdown tables with correct column-separator formatting.
- Linked databases and linked pages (`link_to_page` blocks) are seamlessly detected, fetched, and fully supported, resolving to their target configurations during navigation and markdown export.
- Database row page-content export: when a row inside a database has selected child blocks (grey block icons in the tree), the row's full page content is exported in addition to its table properties. Leaf rows with no selected children are rendered only as table rows.
- Column layout blocks (`column_list`, `column`) are fully supported in exports — each column's content is rendered sequentially in plain text.
- **Escape Key & Dismiss Shortcuts:** Token Manager dialog fully supports dismissing instantly via the `Escape` key shortcut or by clicking outside the modal overlay.
- **Autofill-Resistant Token Inputs:** Token entry inputs are implemented with secure `type="text"` fields styled with visual character masking (`-webkit-text-security: disc`) to prevent password managers and browser credentials auto-fill, while offering a premium Eye-toggle button to show/hide the token.
- **Reliable Fast Refresh / Dev Mode:** Local development mode is optimized to clear stale compilation cache in `.next` directories on startup, and React Strict Mode is disabled to avoid double HMR compiled instances and eradicate static asset `404` errors during hot reload.
