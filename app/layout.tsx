import type { Metadata } from "next";
import "./globals.css";
import PostHogProvider from "./PostHogProvider";

export const metadata: Metadata = {
  title: "VibeCount",
  description: "Invoices for freelancers who hate invoices.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
