import type { Metadata } from "next";
import Script from "next/script";
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
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <Script
          id="vibecount-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
try {
  var theme = window.localStorage.getItem("vibecount-theme");
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
} catch (_) {}
            `.trim(),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
