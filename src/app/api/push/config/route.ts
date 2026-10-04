import { NextResponse } from "next/server";
import { readPushConfig } from "@/lib/push-config";

export const dynamic = "force-dynamic";

export function GET() {
  const config = readPushConfig();
  return NextResponse.json(
    { publicKey: config?.publicKey ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
