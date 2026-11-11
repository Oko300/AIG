import { NextRequest, NextResponse } from "next/server";
import { fetchIntentStatus } from "@/lib/near-intents";

export async function GET(req: NextRequest) {
  const depositAddress = req.nextUrl.searchParams.get("depositAddress");
  if (!depositAddress) {
    return NextResponse.json({ error: "depositAddress query param required" }, { status: 400 });
  }
  try {
    const data = await fetchIntentStatus(depositAddress);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
