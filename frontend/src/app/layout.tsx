import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HalteDB — Sales Intelligence Dashboard",
  description:
    "Real-time sales analytics, profitability tracking, and inventory intelligence for Amazon sellers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
