import { NextResponse } from "next/server";
import { readPushConfig } from "@/lib/push-config";

export const dynamic = "force-dynamic";

function configResponse() {
  const config = readPushConfig();
  return NextResponse.json(
    { publicKey: config?.publicKey ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}

export function GET() {
  return configResponse();
}

// POST skips the installed service worker, which caches same-origin GETs.
export function POST() {
  return configResponse();
}
