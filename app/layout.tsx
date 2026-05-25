import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notionpull",
  description: "Fetch Notion pages and data sources, then export Markdown or CSV."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
