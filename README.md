# Notionpull

Next.js 14 App Router app for fetching shared Notion pages, databases, and data sources, then exporting selected content as Markdown or CSV.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Notes

- Tokens stay in browser `localStorage` under `notion_tokens`.
- Browser never calls `api.notion.com`; all Notion calls use `/api/notion/*` route handlers.
- Notion API version is `2026-03-11`.
- Database rows use `POST /v1/data_sources/{id}/query`.
