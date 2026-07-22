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
  title: "Tape Notes",
  description: "Verified MMA picks, tape notes, and the sharp board",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Every byte of data comes from this one origin - warm up DNS + TLS
            while the JS bundle is still downloading, so the first Supabase
            call on a cold load doesn't pay connection setup on top. */}
        <link rel="preconnect" href="https://fsnhqboyiegzpppdopuj.supabase.co" />
        <link rel="dns-prefetch" href="https://fsnhqboyiegzpppdopuj.supabase.co" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
