# 2. Create README (paste this whole block)
cat > README.md << 'EOF'
# IntentShield AIG — MCP Security Middleware for NEAR Protocol

> NEAR Hackathon 2026 — Build Beyond Boundaries

Pre-flight security layer + MCP server for AI agents executing cross-chain swaps on NEAR Intents. Fetches **real live quotes** from the 1Click API, scores them for risk, and returns APPROVE / REVIEW / CAUTION / BLOCK before any funds move.

## MCP Tools (5)
- `get_supported_tokens` — 229 live tokens from 1Click API
- `get_near_intent_quote` — real dry quote with slippage
- `verify_near_intent` — security analysis verdict
- `submit_deposit_tx` — notify 1Click of deposit
- `check_intent_status` — poll live intent status

## Quick start
```bash
npm install && npm run dev   # http://localhost:3000
npm run mcp                  # stdio MCP server for Claude
```
EOF