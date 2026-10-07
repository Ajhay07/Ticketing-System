import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://frontend-alpha-rose-98.vercel.app"),
  title: { default: "ClickfieldAI Support Portal", template: "%s · ClickfieldAI" },
  description: "Raise, track and resolve support requests with the ClickfieldAI team.",
  applicationName: "ClickfieldAI Support",
  openGraph: {
    title: "ClickfieldAI Support Portal",
    description: "Raise, track and resolve support requests with the ClickfieldAI team.",
    siteName: "ClickfieldAI",
    type: "website",
    images: [{ url: "/branding/clickfieldai-logo.webp", width: 1968, height: 798, alt: "ClickfieldAI" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans text-sm antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
