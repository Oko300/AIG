import { NextResponse } from "next/server";
import { getSupportedTokens } from "@/lib/near-intents";

export async function GET() {
  try {
    const tokens = await getSupportedTokens();
    return NextResponse.json({ tokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
