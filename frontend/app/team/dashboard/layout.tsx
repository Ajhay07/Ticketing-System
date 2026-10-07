import type { Metadata } from "next";

export const metadata: Metadata = { title: "Team dashboard" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
