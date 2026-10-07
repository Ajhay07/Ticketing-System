import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ClickfieldAI Ticketing System", template: "%s · ClickfieldAI" },
  description: "ClickfieldAI Ticketing System",
  applicationName: "ClickfieldAI Ticketing System",
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
