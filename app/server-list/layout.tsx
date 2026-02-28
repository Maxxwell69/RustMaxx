import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Server list | RustMaxx",
  description: "Rust servers that use RustMaxx and have opted in to the public list.",
  openGraph: { title: "Server list | RustMaxx", description: "Find Rust servers using RustMaxx." },
};

export default function ServerListLayout({ children }: { children: React.ReactNode }) {
  return children;
}
