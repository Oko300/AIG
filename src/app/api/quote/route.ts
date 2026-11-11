import { NextRequest, NextResponse } from "next/server";
import { fetchNearIntentQuote, type QuoteRequest } from "@/lib/near-intents";

export async function POST(req: NextRequest) {
  try {
    const body: QuoteRequest = await req.json();
    const data = await fetchNearIntentQuote(body);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
