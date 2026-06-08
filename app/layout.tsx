import type { Metadata } from "next";
import "./globals.css";
import LocatorInit from "@/components/LocatorInit";

export const metadata: Metadata = {
  title: "Notionpull",
  description: "Fetch Notion pages and data sources, then export.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && <LocatorInit />}
        {children}
      </body>
    </html>
  );
}
