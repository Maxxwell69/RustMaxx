import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RustMaxx – Rust Server Admin",
  description: "Rust server web admin panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
