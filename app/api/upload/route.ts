import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { UPLOADS_DIR } from "@/lib/upload-files";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const type = file.type.toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Only images allowed (JPEG, PNG, GIF, WebP)" },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 2MB)" },
        { status: 400 }
      );
    }

    const ext = EXT_MAP[type] || ".jpg";
    const name = `${randomUUID()}${ext}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    const filePath = path.join(UPLOADS_DIR, name);
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    /** Route through the app so images work when static /public serving does not see new files. */
    const url = `/api/uploads/${name}`;
    return NextResponse.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg || "Upload failed" }, { status: 500 });
  }
}
