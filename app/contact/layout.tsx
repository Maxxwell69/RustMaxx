import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact | RustMaxx",
  description: "Get in touch with the RustMaxx team.",
  openGraph: { title: "Contact | RustMaxx", description: "Get in touch." },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}