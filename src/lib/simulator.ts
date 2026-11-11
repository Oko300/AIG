/**
 * IntentShield simulator — calls the real NEAR Intents 1Click API (dry:true)
 * and builds a risk-scored receipt trace from actual quote data.
 *
 * Uses /api/quote (Next.js proxy) so it's safe to call from the browser.
 */

import { getAssetId, getTokenInfo, toBaseUnits, fromBaseUnits } from "./token-map";

export interface IntentRequest {
  sourceChain: string;
  targetChain: string;
  asset: string;
  targetAsset: string;
  amount: number;
  recipient: string;
  refundTo: string;
  slippageTolerance?: number;
}

export interface ReceiptStep {
  step: number;
  action: string;
  status: "SUCCESS" | "WARNING" | "ERROR";
  detail: string;
  shardId?: number;
}

export interface SimulationResult {
  success: boolean;
  intentId: string;
  estimatedSlippage: number;      // percentage
  solverId: string;
  solverReliability: number;      // 0-100
  shardsInvolved: number[];
  receiptTrace: ReceiptStep[];
  riskScore: number;              // 0-100
  recommendation: string;

  // Real API data
  depositAddress?: string;
  originAssetId?: string;
  destinationAssetId?: string;
  amountIn?: string;
  amountOut?: string;
  amountOutFormatted?: number;
  deadline?: string;
  apiError?: string;
}

export interface SolverProfile {
  id: string;
  name: string;
  reliability: number;
  avgSettlementMs: number;
  supportedChains: string[];
  stakeAmount: string;
}

// Real solver names from the NEAR Intents ecosystem
export const ACTIVE_SOLVERS: SolverProfile[] = [
  {
    id: "1click.chaindefuser.near",
    name: "1Click Solver (Defuse)",
    reliability: 99,
    avgSettlementMs: 8000,
    supportedChains: ["near", "ethereum", "arbitrum", "bitcoin", "solana", "base"],
    stakeAmount: "500,000 NEAR",
  },
  {
    id: "ref-finance.near",
    name: "Ref Finance Solver",
    reliability: 97,
    avgSettlementMs: 12000,
    supportedChains: ["near", "arbitrum", "base"],
    stakeAmount: "250,000 NEAR",
  },
  {
    id: "aurora-solver.near",
    name: "Aurora Solver",
    reliability: 95,
    avgSettlementMs: 15000,
    supportedChains: ["near", "ethereum", "base"],
    stakeAmount: "180,000 NEAR",
  },
];

// NEAR Nightshade shards for routing
const CHAIN_SHARD_MAP: Record<string, number> = {
  near: 0, ethereum: 1, bitcoin: 2, arbitrum: 3, solana: 4, base: 1,
};

function pickSolver(source: string, target: string): SolverProfile {
  const capable = ACTIVE_SOLVERS.filter(
    (s) => s.supportedChains.includes(source) && s.supportedChains.includes(target)
  );
  return capable.length > 0 ? capable[0] : ACTIVE_SOLVERS[0];
}

function calcRiskScore(
  sourceChain: string,
  targetChain: string,
  amount: number,
  slippagePct: number,
  apiError?: string
): number {
  let score = 5;
  if (apiError) return 85; // API error = high risk flag
  if (slippagePct > 1.0) score += 25;
  else if (slippagePct > 0.5) score += 12;
  if (amount > 50_000) score += 20;
  else if (amount > 10_000) score += 10;
  if (sourceChain === "bitcoin") score += 20;  // BTC has long finality
  if (sourceChain === "solana")  score += 10;
  if (sourceChain !== "near" && targetChain !== "near") score += 10;
  return Math.min(score, 100);
}

function riskLabel(score: number): string {
  if (score <= 20) return "APPROVE — Low risk. Proceed with intent execution.";
  if (score <= 45) return "REVIEW — Moderate risk. Verify recipient address before proceeding.";
  if (score <= 70) return "CAUTION — Elevated risk. Consider reducing amount or waiting for better rates.";
  return "BLOCK — High risk detected. Manual review required before execution.";
}

/**
 * Run a dry simulation against the real 1Click API.
 * Falls back to estimated values if the API is unavailable.
 */
export async function simulateIntent(req: IntentRequest): Promise<SimulationResult> {
  const originAssetId  = getAssetId(req.sourceChain, req.asset);
  const destAssetId    = getAssetId(req.targetChain, req.targetAsset);
  const originInfo     = getTokenInfo(req.sourceChain, req.asset);
  const destInfo       = getTokenInfo(req.targetChain, req.targetAsset);
  const solver         = pickSolver(req.sourceChain, req.targetChain);
  const shards         = Array.from(new Set([
    CHAIN_SHARD_MAP[req.sourceChain] ?? 0,
    CHAIN_SHARD_MAP[req.targetChain] ?? 0,
  ]));

  // ── Validate token support ──────────────────────────────────────────────────
  if (!originAssetId || !destAssetId) {
    const missing = !originAssetId
      ? `${req.asset} on ${req.sourceChain}`
      : `${req.targetAsset} on ${req.targetChain}`;
    return {
      success: false,
      intentId: `intent_unsupported_${Date.now()}`,
      estimatedSlippage: 0,
      solverId: solver.id,
      solverReliability: solver.reliability,
      shardsInvolved: shards,
      receiptTrace: [
        { step: 1, action: "Asset Validation", status: "ERROR",
          detail: `Unsupported token: ${missing}. Check token-map.ts for supported assets.` }
      ],
      riskScore: 100,
      recommendation: "BLOCK — Unsupported asset pair.",
      apiError: `No NEP-141 mapping for ${missing}`,
    };
  }

  const amountInBaseUnits = toBaseUnits(req.amount, originInfo!.decimals);
  const refundTo  = req.refundTo  || "user.near";
  const recipient = req.recipient || "user.near";

  // ── Call real 1Click API ────────────────────────────────────────────────────
  let quoteData: Record<string, unknown> = {};
  let apiError: string | undefined;

  try {
    const response = await fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        originAsset: originAssetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: destAssetId,
        amount: amountInBaseUnits,
        refundTo,
        refundType: "INTENTS",   // refund stays in NEAR Intents — no EVM address needed
        recipient,
        recipientType: "INTENTS",
        slippageTolerance: req.slippageTolerance ?? 100,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${response.status}: ${errText}`);
    }

    quoteData = await response.json();
    if ((quoteData as { error?: string }).error) {
      throw new Error((quoteData as { error: string }).error);
    }
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }

  // ── Extract real values from quote ─────────────────────────────────────────
  const depositAddress  = (quoteData.depositAddress  as string) ?? undefined;
  const rawAmountOut    = (quoteData.amountOut        as string) ?? "0";
  const rawAmountIn     = ((quoteData.amountIn ?? quoteData.minAmountIn) as string) ?? amountInBaseUnits;
  const deadline        = (quoteData.deadline         as string) ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // Prefer the API's pre-formatted value; fall back to manual base-unit conversion
  const amountOutFormatted = quoteData.amountOutFormatted
    ? parseFloat(String(quoteData.amountOutFormatted))
    : (destInfo ? fromBaseUnits(rawAmountOut, destInfo.decimals) : 0);

  const amountOutNum    = amountOutFormatted;
  const amountInNum     = originInfo ? fromBaseUnits(rawAmountIn,  originInfo.decimals) : req.amount;

  // Real slippage — compare USD values (not base units, which differ across tokens)
  const amountInUsd  = quoteData.amountInUsd  ? parseFloat(String(quoteData.amountInUsd))  : 0;
  const amountOutUsd = quoteData.amountOutUsd ? parseFloat(String(quoteData.amountOutUsd)) : 0;
  const slippagePct = amountInUsd > 0 && amountOutUsd > 0
    ? Math.max(0, ((amountInUsd - amountOutUsd) / amountInUsd) * 100)
    : 0.3; // fallback estimate if API unavailable

  const riskScore    = calcRiskScore(req.sourceChain, req.targetChain, req.amount, slippagePct, apiError);
  const recommendation = riskLabel(riskScore);

  // ── Build receipt trace from real data ─────────────────────────────────────
  const trace: ReceiptStep[] = [
    {
      step: 1,
      action: "Intent Parsed & Validated",
      status: "SUCCESS",
      detail: `${req.amount} ${req.asset} → ${req.targetAsset} | Assets: ${originAssetId} → ${destAssetId}`,
      shardId: 0,
    },
    {
      step: 2,
      action: apiError ? "1Click API Quote — FAILED" : "1Click API Quote — SUCCESS",
      status: apiError ? "ERROR" : "SUCCESS",
      detail: apiError
        ? `API error: ${apiError}. Check NEAR Intents service status.`
        : `Deposit address: ${depositAddress ?? "N/A"} | Deadline: ${new Date(deadline).toLocaleTimeString()}`,
      shardId: 1,
    },
    {
      step: 3,
      action: "Solver Match",
      status: solver.reliability >= 97 ? "SUCCESS" : "WARNING",
      detail: `Solver: ${solver.name} | Reliability: ${solver.reliability}% | Avg settlement: ${(solver.avgSettlementMs / 1000).toFixed(0)}s`,
      shardId: shards[0],
    },
    {
      step: 4,
      action: "Settlement Projection",
      status: slippagePct > 1.0 ? "WARNING" : "SUCCESS",
      detail: apiError
        ? `Estimated slippage ~0.3% (API unavailable — using estimate)`
        : `Real slippage: ${slippagePct.toFixed(4)}% | Out: ${amountOutFormatted.toFixed(6)} ${req.targetAsset}${quoteData.amountOutUsd ? ` (~$${parseFloat(String(quoteData.amountOutUsd)).toFixed(2)})` : ""} | Est: ${quoteData.timeEstimate ?? "?"}s`,
      shardId: shards[shards.length - 1],
    },
  ];

  return {
    success: !apiError,
    intentId: (quoteData.quoteId as string) ?? `intent_dry_${Date.now()}`,
    estimatedSlippage: parseFloat(slippagePct.toFixed(4)),
    solverId: solver.id,
    solverReliability: solver.reliability,
    shardsInvolved: shards,
    receiptTrace: trace,
    riskScore,
    recommendation,
    depositAddress,
    originAssetId,
    destinationAssetId: destAssetId,
    amountIn: rawAmountIn,
    amountOut: rawAmountOut,
    amountOutFormatted: amountOutFormatted,
    deadline,
    apiError,
  };
}
