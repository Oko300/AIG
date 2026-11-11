#!/usr/bin/env node
/**
 * IntentShield AIG — MCP Security Middleware for NEAR Protocol
 *
 * Tools exposed:
 *  1. get_supported_tokens    — live token list from 1Click API
 *  2. get_near_intent_quote   — real dry quote from 1Click API
 *  3. verify_near_intent      — security analysis on a real quote
 *  4. submit_deposit_tx       — notify 1Click of a deposit TX
 *  5. check_intent_status     — poll live status of a submitted intent
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  getSupportedTokens,
  fetchNearIntentQuote,
  fetchDepositSubmit,
  fetchIntentStatus,
  type QuoteRequest,
} from "../lib/near-intents.js";
import { fromBaseUnits } from "../lib/token-map.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "intentshield-aig", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── 1 ─────────────────────────────────────────────────────────────────────
    {
      name: "get_supported_tokens",
      description:
        "Returns the live list of tokens and chains currently supported by the NEAR Intents 1Click API. Use this to discover valid originAsset / destinationAsset values before calling other tools.",
      inputSchema: {
        type: "object",
        properties: {
          filter_chain: {
            type: "string",
            description: "Optional: filter results to a specific blockchain (e.g. 'ethereum', 'near', 'solana').",
          },
        },
      },
    },

    // ── 2 ─────────────────────────────────────────────────────────────────────
    {
      name: "get_near_intent_quote",
      description:
        "Request a real cross-chain swap quote from the NEAR Intents 1Click API (dry run — no funds move). Returns the deposit address, expected output amount, and fee information.",
      inputSchema: {
        type: "object",
        properties: {
          originAsset: {
            type: "string",
            description: "NEP-141 asset ID for the source token, e.g. 'nep141:wrap.near'.",
          },
          destinationAsset: {
            type: "string",
            description: "NEP-141 asset ID for the target token.",
          },
          amount: {
            type: "string",
            description: "Amount to swap in base units (integer string). E.g. '100000000' for 100 USDC.",
          },
          refundTo: {
            type: "string",
            description: "NEAR account ID for refunds, e.g. 'alice.near'.",
          },
          recipient: {
            type: "string",
            description: "Destination address or NEAR account for the output tokens.",
          },
          slippageTolerance: {
            type: "number",
            description: "Slippage tolerance in basis points. Default: 100 (1%).",
          },
        },
        required: ["originAsset", "destinationAsset", "amount", "refundTo", "recipient"],
      },
    },

    // ── 3 ─────────────────────────────────────────────────────────────────────
    {
      name: "verify_near_intent",
      description:
        "Security middleware: fetches a real quote from NEAR Intents and performs a risk analysis. Returns an APPROVE / REVIEW / CAUTION / BLOCK recommendation with detailed risk factors. This is the core IntentShield guard — call it before allowing an AI agent to execute any cross-chain swap.",
      inputSchema: {
        type: "object",
        properties: {
          originAsset:      { type: "string", description: "NEP-141 asset ID for the source token." },
          destinationAsset: { type: "string", description: "NEP-141 asset ID for the target token." },
          amount:           { type: "string", description: "Amount in base units (integer string)." },
          refundTo:         { type: "string", description: "NEAR account for refunds." },
          recipient:        { type: "string", description: "Destination address." },
          maxSlippagePct:   { type: "number", description: "Max acceptable slippage %. If exceeded, returns BLOCK. Default: 1.0." },
          maxAmountUsd:     { type: "number", description: "Max acceptable amount in USD equivalent. If exceeded, adds risk." },
          sourceChain:      { type: "string", description: "Human-readable source chain for context (e.g. 'ethereum')." },
          targetChain:      { type: "string", description: "Human-readable target chain for context (e.g. 'near')." },
        },
        required: ["originAsset", "destinationAsset", "amount", "refundTo", "recipient"],
      },
    },

    // ── 4 ─────────────────────────────────────────────────────────────────────
    {
      name: "submit_deposit_tx",
      description:
        "Notify the NEAR Intents 1Click API that a deposit transaction has been sent. This speeds up processing. Call after the user has actually sent funds to the depositAddress.",
      inputSchema: {
        type: "object",
        properties: {
          depositAddress: {
            type: "string",
            description: "The deposit address returned by get_near_intent_quote.",
          },
          txHash: {
            type: "string",
            description: "The transaction hash from the source chain deposit.",
          },
        },
        required: ["depositAddress", "txHash"],
      },
    },

    // ── 5 ─────────────────────────────────────────────────────────────────────
    {
      name: "check_intent_status",
      description:
        "Check the live execution status of a submitted NEAR Intent by its deposit address. Returns one of: PENDING_DEPOSIT, PROCESSING_CROSS_CHAIN_INTENT, COMPLETED, FAILED, REFUNDED.",
      inputSchema: {
        type: "object",
        properties: {
          depositAddress: {
            type: "string",
            description: "The deposit address from the original quote response.",
          },
        },
        required: ["depositAddress"],
      },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    // ─── 1. get_supported_tokens ───────────────────────────────────────────
    if (name === "get_supported_tokens") {
      const tokens = await getSupportedTokens();
      const filtered = args.filter_chain
        ? tokens.filter((t) =>
            t.blockchain?.toLowerCase() === String(args.filter_chain).toLowerCase()
          )
        : tokens;

      const summary = filtered.slice(0, 50).map((t) => ({
        assetId: t.assetId,
        symbol: t.symbol,
        blockchain: t.blockchain,
        decimals: t.decimals,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total: filtered.length,
                showing: summary.length,
                note: filtered.length > 50 ? "Results truncated to 50. Use filter_chain to narrow." : undefined,
                tokens: summary,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // ─── 2. get_near_intent_quote ──────────────────────────────────────────
    if (name === "get_near_intent_quote") {
      const quoteReq: QuoteRequest = {
        originAsset:      String(args.originAsset),
        destinationAsset: String(args.destinationAsset),
        amount:           String(args.amount),
        refundTo:         String(args.refundTo),
        recipient:        String(args.recipient),
        slippageTolerance: args.slippageTolerance ? Number(args.slippageTolerance) : 100,
        dry: true,
      };

      const quote = await fetchNearIntentQuote(quoteReq);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                depositAddress:  quote.depositAddress,
                amountOut:       quote.amountOut,
                minAmountIn:     quote.minAmountIn,
                maxAmountIn:     quote.maxAmountIn,
                deadline:        quote.deadline,
                depositType:     quote.depositType,
                note: "This is a dry quote. No funds have moved. Send funds to depositAddress to execute.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // ─── 3. verify_near_intent ─────────────────────────────────────────────
    if (name === "verify_near_intent") {
      const maxSlippage  = Number(args.maxSlippagePct ?? 1.0);
      const maxAmountUsd = Number(args.maxAmountUsd ?? Infinity);
      const sourceChain  = String(args.sourceChain ?? "unknown");
      const targetChain  = String(args.targetChain ?? "unknown");

      // Fetch real quote
      const quote = await fetchNearIntentQuote({
        originAsset:      String(args.originAsset),
        destinationAsset: String(args.destinationAsset),
        amount:           String(args.amount),
        refundTo:         String(args.refundTo),
        recipient:        String(args.recipient),
        slippageTolerance: 100,
        dry: true,
      });

      // ── Risk factors ───────────────────────────────────────────────────────
      const riskFactors: { factor: string; severity: "LOW" | "MEDIUM" | "HIGH"; detail: string }[] = [];
      let riskScore = 5;

      // Slippage analysis
      const amountInRaw  = Number(quote.minAmountIn ?? quote.amountIn ?? args.amount);
      const amountOutRaw = Number(quote.amountOut ?? 0);
      const slippagePct  = amountInRaw > 0 && amountOutRaw > 0
        ? ((amountInRaw - amountOutRaw) / amountInRaw) * 100
        : 0;

      if (slippagePct > maxSlippage) {
        riskFactors.push({
          factor: "SLIPPAGE_EXCEEDED",
          severity: "HIGH",
          detail: `Real slippage ${slippagePct.toFixed(4)}% exceeds your limit of ${maxSlippage}%.`,
        });
        riskScore += 35;
      } else if (slippagePct > 0.5) {
        riskFactors.push({
          factor: "ELEVATED_SLIPPAGE",
          severity: "MEDIUM",
          detail: `Slippage ${slippagePct.toFixed(4)}% is above typical. Consider smaller amount.`,
        });
        riskScore += 15;
      } else {
        riskFactors.push({
          factor: "SLIPPAGE_OK",
          severity: "LOW",
          detail: `Slippage ${slippagePct.toFixed(4)}% is within normal range.`,
        });
      }

      // Chain-specific risk
      if (sourceChain === "bitcoin") {
        riskFactors.push({ factor: "BITCOIN_FINALITY", severity: "MEDIUM",
          detail: "Bitcoin requires ~6 block confirmations (~60 min). Long settlement time." });
        riskScore += 20;
      }
      if (sourceChain === "solana") {
        riskFactors.push({ factor: "SOLANA_FINALITY", severity: "LOW",
          detail: "Solana has fast finality but occasional network congestion." });
        riskScore += 8;
      }

      // Amount risk
      const amountNum = Number(args.amount);
      if (!isNaN(amountNum) && amountNum > maxAmountUsd * 1e6) {
        riskFactors.push({ factor: "AMOUNT_EXCEEDS_LIMIT", severity: "HIGH",
          detail: `Amount in base units exceeds your maxAmountUsd of $${maxAmountUsd}.` });
        riskScore += 25;
      }

      // Deposit address sanity check
      if (!quote.depositAddress || quote.depositAddress.length < 10) {
        riskFactors.push({ factor: "INVALID_DEPOSIT_ADDRESS", severity: "HIGH",
          detail: "API returned an invalid or missing deposit address." });
        riskScore += 40;
      }

      // Deadline check
      const deadlineMs = quote.deadline ? new Date(quote.deadline).getTime() - Date.now() : 0;
      if (deadlineMs < 5 * 60 * 1000) {
        riskFactors.push({ factor: "QUOTE_EXPIRING_SOON", severity: "MEDIUM",
          detail: `Quote expires in ${Math.round(deadlineMs / 1000)}s. Act quickly or re-quote.` });
        riskScore += 10;
      }

      riskScore = Math.min(riskScore, 100);

      let verdict: string;
      if      (riskScore <= 20) verdict = "APPROVE";
      else if (riskScore <= 45) verdict = "REVIEW";
      else if (riskScore <= 70) verdict = "CAUTION";
      else                       verdict = "BLOCK";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                verdict,
                riskScore,
                slippagePct: parseFloat(slippagePct.toFixed(4)),
                depositAddress: quote.depositAddress,
                amountOut:      quote.amountOut,
                deadline:       quote.deadline,
                riskFactors,
                recommendation:
                  verdict === "APPROVE" ? "Intent passes all security checks. Safe to proceed." :
                  verdict === "REVIEW"  ? "Review risk factors before allowing execution." :
                  verdict === "CAUTION" ? "High risk detected. Manual approval required." :
                  "BLOCKED. Do not execute. Address risk factors first.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // ─── 4. submit_deposit_tx ──────────────────────────────────────────────
    if (name === "submit_deposit_tx") {
      const result = await fetchDepositSubmit(
        String(args.depositAddress),
        String(args.txHash)
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...result,
                depositAddress: args.depositAddress,
                txHash:         args.txHash,
                note: "NEAR Intents has been notified. Use check_intent_status to track progress.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // ─── 5. check_intent_status ────────────────────────────────────────────
    if (name === "check_intent_status") {
      const status = await fetchIntentStatus(String(args.depositAddress));

      const isTerminal = status.status === "COMPLETED" || status.status === "FAILED" || status.status === "REFUNDED";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                depositAddress: args.depositAddress,
                status:         status.status,
                txHash:         status.txHash,
                amountIn:       status.amountIn,
                amountOut:      status.amountOut,
                timestamp:      status.timestamp,
                isTerminal,
                nextAction: isTerminal
                  ? `Intent is in terminal state: ${status.status}.`
                  : "Intent still processing. Poll again in ~10 seconds.",
                explorerUrl: `https://app.near-intents.org/?depositAddress=${args.depositAddress}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error in ${name}: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("[IntentShield MCP] Server running on stdio — 5 tools ready.");
}).catch((err) => {
  console.error("[IntentShield MCP] Failed to start:", err);
  process.exit(1);
});
