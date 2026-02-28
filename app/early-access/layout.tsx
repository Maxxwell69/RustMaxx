import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get early access – RustMaxx",
  description: "Sign up for early access to RustMaxx. One command center for Rust servers.",
};

export default function EarlyAccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
