# Notionpull

Next.js 14 App Router app for fetching shared Notion pages, databases, and data sources, then exporting selected content.

## Features

- **Finder-like Navigation:** Expandable list view for browsing nested Notion structures with intuitive icons.
- **Granular Database Exports:** Configure which columns to export for each database, complete with a live data preview.
- **Simple Table Support:** Seamlessly detects, displays, and formats standard Notion simple tables into pristine Markdown tables, including granular selection of individual rows.
- **Smart Caching:** Local memory caching ensures that returning to a previously fetched depth level is instant. 
- **Recent URLs:** Quick access to recently fetched Notion URLs.
- **Export Progress:** Visual "building block" animation while fetching export data.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Notes

- Tokens stay in browser `localStorage` under `notion_tokens`.
- URL history stays in browser `localStorage` under `notionpull_history`.
- Browser never calls `api.notion.com`; all Notion calls use `/api/notion/*` route handlers.
- Notion API version is `2026-03-11`.
- Database rows use `POST /v1/data_sources/{id}/query`.
- Notion ID parser extracts both 32-character compact IDs and 36-character standard UUIDs from any shared URL, preserving hyphen boundaries and safely ignoring preceding slugs.
- Column definitions for empty databases (databases with zero rows/entries) are correctly resolved by falling back to the static database schema (`database.properties`) instead of returning empty properties.
- Database exports correctly include the full column list and structural schema metadata (including column names, types, options, and descriptions) even for empty databases with zero rows/entries.
- Block-level URL detection allows directly pasting block-level links (like table blocks) into the query input to fetch, traverse, and export their child elements.
- Simple tables (`table` and `table_row` blocks) are fully supported in exports, parsing individual row cells recursively and auto-generating standard Markdown tables with correct column-separator formatting.
