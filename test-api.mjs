// Quick live API test — run with: node test-api.mjs
const BASE = "http://localhost:3000";

async function run() {
  console.log("1) Testing /api/tokens...");
  const tokRes = await fetch(`${BASE}/api/tokens`);
  const tokData = await tokRes.json();
  console.log(`   ✅ ${tokData.tokens?.length ?? 0} tokens returned`);
  if (tokData.tokens?.[0]) console.log("   First token:", JSON.stringify(tokData.tokens[0]));

  console.log("\n2) Testing /api/quote (dry:true, 100 USDC ETH → NEAR)...");
  const quoteRes = await fetch(`${BASE}/api/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      originAsset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:wrap.near",
      amount: "100000000",         // 100 USDC (6 decimals)
      refundTo: "user.near",
      refundType: "INTENTS",
      recipient: "user.near",
      recipientType: "INTENTS",
      slippageTolerance: 100,
    }),
  });
  const quoteData = await quoteRes.json();
  console.log(`   Status: ${quoteRes.status}`);
  if (quoteData.error) {
    console.log("   ❌ Error:", quoteData.error);
  } else {
    console.log("   ✅ Quote received!");
    console.log("   depositAddress:", quoteData.depositAddress);
    console.log("   amountOut:", quoteData.amountOut);
    console.log("   minAmountIn:", quoteData.minAmountIn);
    console.log("   maxAmountIn:", quoteData.maxAmountIn);
    console.log("   deadline:", quoteData.deadline);
    // Calculate real slippage
    if (quoteData.minAmountIn && quoteData.amountOut) {
      const inNum  = Number(quoteData.minAmountIn);
      const outNum = Number(quoteData.amountOut);
      const slip   = ((inNum - outNum) / inNum * 100).toFixed(4);
      console.log(`   Real slippage: ${slip}%`);
    }
    console.log("\n   Full response:", JSON.stringify(quoteData, null, 2));
  }
}

run().catch(console.error);
