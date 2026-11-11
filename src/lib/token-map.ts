// Real NEP-141 asset IDs from the NEAR Intents 1Click API
// Source: https://docs.near-intents.org / https://1click.chaindefuser.com/v0/tokens

export interface TokenInfo {
  assetId: string;
  symbol: string;
  decimals: number;
  chain: string;
  label: string;
}

export const TOKEN_MAP: Record<string, Record<string, TokenInfo>> = {
  ethereum: {
    USDC: {
      assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
      symbol: "USDC", decimals: 6, chain: "ethereum", label: "USDC (Ethereum)",
    },
    ETH: {
      assetId: "nep141:eth.omft.near",
      symbol: "ETH", decimals: 18, chain: "ethereum", label: "ETH (Ethereum)",
    },
  },
  bitcoin: {
    BTC: {
      assetId: "nep141:btc.omft.near",
      symbol: "BTC", decimals: 8, chain: "bitcoin", label: "BTC (Bitcoin)",
    },
  },
  near: {
    NEAR: {
      assetId: "nep141:wrap.near",
      symbol: "NEAR", decimals: 24, chain: "near", label: "NEAR (wNEAR)",
    },
    USDC: {
      assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      symbol: "USDC", decimals: 6, chain: "near", label: "USDC (NEAR native)",
    },
  },
  arbitrum: {
    USDC: {
      assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
      symbol: "USDC", decimals: 6, chain: "arbitrum", label: "USDC (Arbitrum)",
    },
    ARB: {
      assetId: "nep141:arb-0x912ce59144191c1204e64559fe8253a0e49e6548.omft.near",
      symbol: "ARB", decimals: 18, chain: "arbitrum", label: "ARB (Arbitrum)",
    },
    ETH: {
      assetId: "nep141:arb-0x82af49447d8a07e3bd95bd0d56f35241523fbab1.omft.near",
      symbol: "ETH", decimals: 18, chain: "arbitrum", label: "ETH (Arbitrum)",
    },
  },
  solana: {
    USDC: {
      assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
      symbol: "USDC", decimals: 6, chain: "solana", label: "USDC (Solana)",
    },
  },
  base: {
    USDC: {
      assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      symbol: "USDC", decimals: 6, chain: "base", label: "USDC (Base)",
    },
    ETH: {
      assetId: "nep141:base-0x4200000000000000000000000000000000000006.omft.near",
      symbol: "ETH", decimals: 18, chain: "base", label: "ETH (Base)",
    },
  },
};

export function getAssetId(chain: string, symbol: string): string | null {
  return TOKEN_MAP[chain]?.[symbol]?.assetId ?? null;
}

export function getTokenInfo(chain: string, symbol: string): TokenInfo | null {
  return TOKEN_MAP[chain]?.[symbol] ?? null;
}

export function getAvailableAssets(chain: string): string[] {
  return Object.keys(TOKEN_MAP[chain] ?? {});
}

/**
 * Convert a human-readable amount to on-chain base units (integer string).
 * Uses BigInt for high-decimal tokens like NEAR (24) to avoid float overflow.
 */
export function toBaseUnits(amount: number, decimals: number): string {
  if (Number.isInteger(amount)) {
    return (BigInt(amount) * BigInt(10) ** BigInt(decimals)).toString();
  }
  // For fractional amounts, scale by up to 6 decimal places to avoid float errors
  const scale = Math.min(decimals, 6);
  const scaledInt = Math.round(amount * 10 ** scale);
  const remaining = decimals - scale;
  return (BigInt(scaledInt) * BigInt(10) ** BigInt(remaining)).toString();
}

/**
 * Convert base units back to a human-readable decimal string.
 */
export function fromBaseUnits(amount: string, decimals: number): number {
  if (!amount || amount === "0") return 0;
  const padded = amount.padStart(decimals + 1, "0");
  const intPart  = padded.slice(0, padded.length - decimals) || "0";
  const fracPart = padded.slice(padded.length - decimals);
  return parseFloat(`${intPart}.${fracPart}`);
}
