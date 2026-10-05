import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "IVR Console", template: "%s · IVR Console" },
  description: "Chakra Labs' IVR Console: customers, licences and API keys, usage, and the GPU fleet's health and performance; companies sign in to see their own.",
  applicationName: "IVR Console",
  authors: [{ name: "Chakra Labs" }],
  // A private admin tool: keep it out of search engines.
  robots: { index: false, follow: false },
  // Icons: app/icon.png, app/apple-icon.png and app/favicon.ico (the Chakra mark).
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
