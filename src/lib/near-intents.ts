/**
 * Real NEAR Intents 1Click API client.
 * Base URL: https://1click.chaindefuser.com
 * Docs: https://docs.near-intents.org/near-intents/1click-api
 *
 * No API key needed for dry:true simulation.
 * With an API key (NEAR_INTENTS_API_KEY env), the 0.2% fee is waived on live swaps.
 */

const BASE_URL = "https://1click.chaindefuser.com";

function authHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const key = process.env.NEAR_INTENTS_API_KEY;
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

// ─── Token list ───────────────────────────────────────────────────────────────

export interface NearToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  contractAddress?: string;
  name?: string;
}

export async function getSupportedTokens(): Promise<NearToken[]> {
  const r = await fetch(`${BASE_URL}/v0/tokens`, {
    headers: authHeaders(),
    next: { revalidate: 300 }, // cache for 5 min (Next.js only)
  } as RequestInit);
  if (!r.ok) throw new Error(`Tokens API error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  // API returns either { tokens: [...] } or directly [...]
  return Array.isArray(data) ? data : (data.tokens ?? []);
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export interface QuoteRequest {
  originAsset: string;        // NEP-141 asset ID, e.g. "nep141:wrap.near"
  destinationAsset: string;   // NEP-141 asset ID
  amount: string;             // base units string, e.g. "100000000" for 100 USDC
  refundTo: string;           // NEAR account for refunds, e.g. "alice.near"
  recipient: string;          // destination address or NEAR account
  recipientType?: "DESTINATION_CHAIN" | "INTENTS";
  depositType?: "ORIGIN_CHAIN" | "INTENTS";
  refundType?: "ORIGIN_CHAIN" | "INTENTS";
  slippageTolerance?: number; // basis points, default 100 (1%)
  dry?: boolean;              // true = no funds move, returns min/maxAmountIn
}

export interface QuoteResponse {
  quoteId?: string;
  depositAddress: string;
  amountIn?: string;           // exact amount (dry:false)
  minAmountIn?: string;        // range low    (dry:true)
  maxAmountIn?: string;        // range high   (dry:true)
  amountOut: string;
  minAmountOut?: string;
  amountOutFormatted?: string; // human-readable, e.g. "28.067..."
  amountOutUsd?: string;
  amountInUsd?: string;
  timeEstimate?: number;       // seconds
  deadline: string;
  depositType: string;
  recipientType: string;
  refundType: string;
  totalFee?: string;
  slippageTolerance?: number;
  signature?: string;
  [key: string]: unknown;
}

export async function fetchNearIntentQuote(params: QuoteRequest): Promise<QuoteResponse> {
  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const body = {
    dry: params.dry ?? true,
    swapType: "EXACT_INPUT",
    slippageTolerance: params.slippageTolerance ?? 100,
    originAsset: params.originAsset,
    depositType: params.depositType ?? "ORIGIN_CHAIN",
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    recipient: params.recipient,
    recipientType: params.recipientType ?? "INTENTS",
    refundTo: params.refundTo,
    refundType: params.refundType ?? "INTENTS",
    deadline,
  };

  const r = await fetch(`${BASE_URL}/v0/quote`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Quote API error (${r.status}): ${text}`);
  }

  const json = await r.json();
  // 1Click API v0 wraps amounts under "quote" and metadata at the top level.
  // For dry:true, there is no depositAddress (no real intent created yet).
  // For dry:false, depositAddress appears at the top level.
  if (json.quote) {
    return {
      depositAddress:  json.depositAddress ?? "(dry run — no deposit address)",
      amountIn:        json.quote.amountIn,
      minAmountIn:     json.quote.minAmountIn,
      maxAmountIn:     json.quote.maxAmountIn ?? json.quote.amountIn,
      amountOut:       json.quote.amountOut,
      minAmountOut:    json.quote.minAmountOut,
      amountOutFormatted: json.quote.amountOutFormatted,
      amountOutUsd:    json.quote.amountOutUsd,
      amountInUsd:     json.quote.amountInUsd,
      timeEstimate:    json.quote.timeEstimate,
      deadline:        json.quoteRequest?.deadline ?? json.timestamp,
      quoteId:         json.correlationId,
      depositType:     json.quoteRequest?.depositType ?? "ORIGIN_CHAIN",
      recipientType:   json.quoteRequest?.recipientType ?? "INTENTS",
      refundType:      json.quoteRequest?.refundType ?? "INTENTS",
      signature:       json.signature,
    } as QuoteResponse;
  }
  return json as QuoteResponse;
}

// ─── Deposit submit ───────────────────────────────────────────────────────────

export interface DepositSubmitResponse {
  success: boolean;
  status: string;
  [key: string]: unknown;
}

export async function fetchDepositSubmit(
  depositAddress: string,
  txHash: string
): Promise<DepositSubmitResponse> {
  const r = await fetch(`${BASE_URL}/v0/deposit/submit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ depositAddress, txHash }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Deposit submit error (${r.status}): ${text}`);
  }

  const data = await r.json();
  return { success: true, status: "PROCESSING_CROSS_CHAIN_INTENT", ...data };
}

// ─── Status check ─────────────────────────────────────────────────────────────

export type IntentStatusCode =
  | "PENDING_DEPOSIT"
  | "PROCESSING_CROSS_CHAIN_INTENT"
  | "COMPLETED"
  | "FAILED"
  | "REFUNDED"
  | string;

export interface IntentStatusResponse {
  status: IntentStatusCode;
  depositAddress?: string;
  txHash?: string;
  timestamp?: string;
  amountIn?: string;
  amountOut?: string;
  [key: string]: unknown;
}

export async function fetchIntentStatus(depositAddress: string): Promise<IntentStatusResponse> {
  const url = `${BASE_URL}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Status API error (${r.status}): ${text}`);
  }
  return r.json();
}
