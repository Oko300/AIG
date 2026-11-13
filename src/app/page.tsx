"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield, Cpu, Zap, AlertTriangle, CheckCircle2,
  Activity, Terminal, Layers, Server, Wallet,
  RefreshCw, ExternalLink, Radio, XCircle,
} from "lucide-react";
import { simulateIntent, ACTIVE_SOLVERS, SimulationResult } from "@/lib/simulator";
import { TOKEN_MAP, getAvailableAssets } from "@/lib/token-map";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === "COMPLETED") return "text-emerald-400";
  if (s === "FAILED" || s === "REFUNDED") return "text-red-400";
  return "text-amber-400";
}

function statusBg(s: string) {
  if (s === "COMPLETED") return "bg-emerald-500/10 border-emerald-500/30";
  if (s === "FAILED" || s === "REFUNDED") return "bg-red-500/10 border-red-500/30";
  return "bg-amber-500/10 border-amber-500/30";
}

const NEAR_ACCOUNT_RE = /^[a-z0-9_.-]{2,64}(\.near|\.testnet)?$/i;

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [sourceChain, setSourceChain]   = useState("ethereum");
  const [targetChain, setTargetChain]   = useState("near");
  const [asset, setAsset]               = useState("USDC");
  const [targetAsset, setTargetAsset]   = useState("NEAR");
  const [amount, setAmount]             = useState<number>(100);
  const [recipient, setRecipient]       = useState("user.near");

  // Dynamic asset options based on selected chain
  const [srcAssets, setSrcAssets]       = useState<string[]>(["USDC", "ETH"]);
  const [dstAssets, setDstAssets]       = useState<string[]>(["NEAR", "USDC"]);

  // ── Wallet state ────────────────────────────────────────────────────────────
  const [walletInput, setWalletInput]   = useState("user.near");
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [walletError, setWalletError]   = useState<string | null>(null);

  // ── Simulation state ────────────────────────────────────────────────────────
  const [simulation, setSimulation]     = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError]         = useState<string | null>(null);
  const [mounted, setMounted]           = useState(false);

  // ── Status tracker state ────────────────────────────────────────────────────
  const [trackAddress, setTrackAddress] = useState("");
  interface IntentStatusData { status: string; txHash?: string; timestamp?: string; amountIn?: string; amountOut?: string; [key: string]: unknown; }
  const [intentStatus, setIntentStatus] = useState<IntentStatusData | null>(null);
  const [isPolling, setIsPolling]       = useState(false);
  const [pollError, setPollError]       = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Sync asset lists when chains change ────────────────────────────────────
  useEffect(() => {
    const assets = getAvailableAssets(sourceChain);
    setSrcAssets(assets);
    if (!assets.includes(asset)) setAsset(assets[0] || "USDC");
  }, [sourceChain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const assets = getAvailableAssets(targetChain);
    setDstAssets(assets);
    if (!assets.includes(targetAsset)) setTargetAsset(assets[0] || "NEAR");
  }, [targetChain]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup polling on unmount ──────────────────────────────────────────────
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // ─── Core simulation runner ─────────────────────────────────────────────────
  const runSimulation = useCallback(async (
    sc: string, tc: string, a: string, ta: string,
    amt: number, rcpt: string, refund: string
  ) => {
    setIsSimulating(true);
    setSimError(null);
    try {
      const res = await simulateIntent({
        sourceChain: sc,
        targetChain: tc,
        asset: a,
        targetAsset: ta,
        amount: amt,
        recipient: rcpt,
        refundTo: refund,
      });
      setSimulation(res);
      // Auto-populate tracker with the deposit address if we got one
      if (res.depositAddress) setTrackAddress(res.depositAddress);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setIsSimulating(false);
    }
  }, []);

  const handleRunSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    runSimulation(
      sourceChain, targetChain, asset, targetAsset,
      Number(amount), recipient,
      connectedWallet || "user.near"
    );
  };

  // ── Wallet connect ──────────────────────────────────────────────────────────
  const handleConnectWallet = () => {
    setWalletError(null);
    if (!walletInput.trim()) {
      setWalletError("Enter a NEAR account ID");
      return;
    }
    if (!NEAR_ACCOUNT_RE.test(walletInput.trim())) {
      setWalletError("Invalid NEAR account ID format (e.g. alice.near)");
      return;
    }
    setConnectedWallet(walletInput.trim());
  };

  const handleDisconnect = () => {
    setConnectedWallet(null);
    setWalletInput("user.near");
  };

  // ── Status polling ──────────────────────────────────────────────────────────
  const doPoll = useCallback(async (address: string) => {
    try {
      const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(address)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as IntentStatusData;
      setIntentStatus(data);

      const terminal = ["COMPLETED", "FAILED", "REFUNDED"].includes(data.status);
      if (!terminal) {
        pollRef.current = setTimeout(() => doPoll(address), 8000);
      } else {
        setIsPolling(false);
      }
    } catch (err) {
      setPollError(err instanceof Error ? err.message : "Poll failed");
      setIsPolling(false);
    }
  }, []);

  const handleStartPolling = () => {
    if (!trackAddress.trim()) return;
    setPollError(null);
    setIntentStatus(null);
    setIsPolling(true);
    if (pollRef.current) clearTimeout(pollRef.current);
    doPoll(trackAddress.trim());
  };

  const handleStopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setIsPolling(false);
  };

  // ── MCP Panel component ─────────────────────────────────────────────────────
  function McpPanel() {
    const [copied, setCopied] = useState<string | null>(null);

    const copy = (text: string, key: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
      });
    };

    const claudeConfig = `{
  "mcpServers": {
    "intentshield": {
      "command": "npx",
      "args": ["tsx", "/path/to/AIG/src/mcp/server.ts"]
    }
  }
}`;

    const tools = [
      { name: "get_supported_tokens", desc: "List 229 live tokens from 1Click API", example: `{"filter_chain": "ethereum"}` },
      { name: "verify_near_intent",   desc: "Risk score a swap before executing",   example: `{"originAsset":"nep141:wrap.near","destinationAsset":"nep141:eth.omft.near","amount":"1000000000000000000000000","refundTo":"you.near","recipient":"you.near"}` },
      { name: "get_near_intent_quote",desc: "Real dry quote — amounts & fees",       example: `{"originAsset":"nep141:wrap.near","destinationAsset":"nep141:eth.omft.near","amount":"1000000000000000000000000","refundTo":"you.near","recipient":"you.near"}` },
      { name: "submit_deposit_tx",    desc: "Notify 1Click of a deposit TX hash",   example: `{"depositAddress":"0xABC...","txHash":"0xDEF..."}` },
      { name: "check_intent_status",  desc: "Poll live execution status",            example: `{"depositAddress":"0xABC..."}` },
    ];

    return (
      <div className="bg-[#111827] border border-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-md font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            MCP Server — 5 Tools
          </h3>
          <span className="text-[10px] text-gray-500 font-mono">stdio transport</span>
        </div>

        {/* Claude Desktop config */}
        <div className="mb-4 p-3 bg-[#0a0f1d] border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Claude Desktop Config</span>
            <button
              onClick={() => copy(claudeConfig, "config")}
              className="text-[10px] px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded transition"
            >
              {copied === "config" ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <pre className="text-[10px] text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap">{claudeConfig}</pre>
        </div>

        {/* Tool list */}
        <div className="space-y-2">
          {tools.map((t) => (
            <div key={t.name} className="p-3 bg-[#0a0f1d] border border-gray-800 rounded-xl">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <code className="text-xs font-bold text-emerald-400">{t.name}</code>
                  <p className="text-[10px] text-gray-500 mt-0.5">{t.desc}</p>
                </div>
                <button
                  onClick={() => copy(t.example, t.name)}
                  className="flex-shrink-0 text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-emerald-400 rounded transition"
                >
                  {copied === t.name ? "✓ Copied!" : "Copy args"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-gray-600 mt-3 text-center">
          Run locally: <code className="text-gray-500">npm run mcp</code> · then add config above to Claude Desktop
        </p>
      </div>
    );
  }

  // ── Render guard ────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <main className="min-h-screen bg-[#0a0f1d] text-gray-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-emerald-400">
          <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <span className="font-semibold">Booting IntentShield AIG...</span>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#0a0f1d] text-gray-100 p-4 md:p-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
            <Shield className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              IntentShield AIG
            </h1>
            <p className="text-xs text-gray-400">
              Asynchronous Intent Guard & MCP Security Middleware for NEAR Protocol
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Live 1Click API
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Layers className="w-3.5 h-3.5" />
            5 MCP Tools Active
          </span>
          {/* Wallet pill */}
          {connectedWallet ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <Wallet className="w-3 h-3" />
              {connectedWallet}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-700/30 text-gray-500 border border-gray-700">
              <Wallet className="w-3 h-3" />
              No wallet
            </span>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ── Left Column ───────────────────────────────────────────────────── */}
        <div className="lg:col-span-5 space-y-6">

          {/* Wallet Panel */}
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Wallet className="w-4 h-4 text-teal-400" />
              NEAR Wallet
            </h2>
            {connectedWallet ? (
              <div className="flex items-center justify-between p-3 bg-teal-500/10 border border-teal-500/30 rounded-xl">
                <div>
                  <p className="text-xs text-teal-400 font-medium">Connected</p>
                  <p className="text-sm font-bold text-white">{connectedWallet}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Used as refundTo for all quotes</p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="yourname.near"
                  className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-teal-500"
                />
                {walletError && <p className="text-xs text-red-400">{walletError}</p>}
                <button
                  onClick={handleConnectWallet}
                  className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg transition"
                >
                  Connect Wallet
                </button>
              </div>
            )}
          </div>

          {/* Intent Configuration Form */}
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                Configure Intent
              </h2>
              <span className="text-xs text-gray-500 font-mono">dry:true · real API</span>
            </div>

            <form onSubmit={handleRunSimulation} className="space-y-4">
              {/* Source */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Source Chain</label>
                  <select value={sourceChain} onChange={(e) => setSourceChain(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500">
                    {Object.keys(TOKEN_MAP).map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Source Asset</label>
                  <select value={asset} onChange={(e) => setAsset(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500">
                    {srcAssets.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Target */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Target Chain</label>
                  <select value={targetChain} onChange={(e) => setTargetChain(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500">
                    {Object.keys(TOKEN_MAP).map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Target Asset</label>
                  <select value={targetAsset} onChange={(e) => setTargetAsset(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500">
                    {dstAssets.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Amount ({asset})
                </label>
                <input type="number" min="1" value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Recipient */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Recipient (NEAR account or EVM address)</label>
                <input type="text" value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="w-full bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {simError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  {simError}
                </div>
              )}

              <button type="submit" disabled={isSimulating}
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-60 disabled:cursor-not-allowed text-gray-950 font-bold rounded-xl shadow-lg transition duration-200 flex items-center justify-center gap-2">
                {isSimulating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Fetching Live Quote…
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Run Pre-Flight Simulation
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Active Solvers */}
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" />
              Registered Solver Ecosystem
            </h3>
            <div className="space-y-2">
              {ACTIVE_SOLVERS.map((s) => (
                <div key={s.id} className="p-3 bg-[#0a0f1d] border border-gray-800 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-gray-200">{s.name}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{s.id}</div>
                    <div className="text-[10px] text-gray-500">Staked: {s.stakeAmount}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-emerald-400">{s.reliability}%</span>
                    <div className="text-[10px] text-gray-500">{(s.avgSettlementMs / 1000).toFixed(0)}s avg</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>{/* end left col */}

        {/* ── Right Column ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-7 space-y-6">

          {/* Empty state — before first run */}
          {!simulation && !isSimulating && (
            <div className="p-10 rounded-2xl border border-dashed border-gray-700 bg-[#111827]/50 flex flex-col items-center justify-center text-center gap-3">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                <Zap className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-white font-semibold">No simulation yet</p>
              <p className="text-xs text-gray-500 max-w-xs">
                Configure your intent on the left and click <span className="text-emerald-400 font-semibold">Run Pre-Flight Simulation</span> to get a live quote from the NEAR Intents 1Click API.
              </p>
            </div>
          )}

          {/* Loading skeleton */}
          {isSimulating && (
            <div className="p-6 rounded-2xl border border-gray-800 bg-[#111827] animate-pulse flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-800" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-800 rounded w-2/3" />
                <div className="h-3 bg-gray-800 rounded w-1/2" />
                <div className="h-3 bg-gray-800 rounded w-1/3" />
              </div>
            </div>
          )}

          {simulation && (
            <>
              {/* Status Banner */}
              <div className={`p-6 rounded-2xl border shadow-xl flex items-start justify-between gap-4 ${
                simulation.apiError
                  ? "bg-amber-950/20 border-amber-500/40"
                  : simulation.success
                  ? "bg-emerald-950/20 border-emerald-500/40"
                  : "bg-red-950/20 border-red-500/40"
              }`}>
                <div className="flex items-start gap-4">
                  {simulation.success && !simulation.apiError ? (
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 flex-shrink-0 mt-0.5" />
                  ) : simulation.apiError ? (
                    <AlertTriangle className="w-10 h-10 text-amber-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-10 h-10 text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1">
                      Intent ID: <span className="font-mono text-gray-400">{simulation.intentId}</span>
                    </div>
                    <div className="text-base font-extrabold text-white">
                      {simulation.apiError
                        ? "API Error — Showing estimated values"
                        : simulation.success
                        ? "Live Quote Received — Intent Verified"
                        : "Unsupported Asset Pair"}
                    </div>
                    {simulation.apiError && (
                      <p className="text-xs text-amber-300 mt-1 font-mono break-all">{simulation.apiError}</p>
                    )}
                    <p className="text-xs text-gray-300 mt-1">{simulation.recommendation}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Risk</div>
                  <div className={`text-3xl font-black ${simulation.riskScore > 50 ? "text-red-400" : simulation.riskScore > 25 ? "text-amber-400" : "text-emerald-400"}`}>
                    {simulation.riskScore}
                  </div>
                  <div className="text-[10px] text-gray-500">/100</div>
                </div>
              </div>

              {/* Metrics Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#111827] border border-gray-800 rounded-xl p-4">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Slippage</div>
                  <div className="text-xl font-bold text-white mt-1">
                    {simulation.estimatedSlippage === 0 && simulation.apiError
                      ? "~0.3%"
                      : `${simulation.estimatedSlippage}%`}
                  </div>
                  <div className={`text-[10px] mt-1 ${simulation.apiError ? "text-amber-400" : "text-emerald-400"}`}>
                    {simulation.apiError ? "Estimated" : "Real from API"}
                  </div>
                </div>

                <div className="bg-[#111827] border border-gray-800 rounded-xl p-4">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Output</div>
                  <div className="text-xl font-bold text-white mt-1 truncate">
                    {simulation.amountOutFormatted != null && simulation.amountOutFormatted > 0
                      ? simulation.amountOutFormatted.toFixed(4)
                      : "—"}
                  </div>
                  <div className="text-[10px] text-blue-400 mt-1">{simulation.amountOutFormatted != null ? "real API value" : "unavailable"}</div>
                </div>

                <div className="bg-[#111827] border border-gray-800 rounded-xl p-4">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Solver</div>
                  <div className="text-xl font-bold text-white mt-1">{simulation.solverReliability}%</div>
                  <div className="text-[10px] text-purple-400 mt-1">Reliability</div>
                </div>

                <div className="bg-[#111827] border border-gray-800 rounded-xl p-4">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Shards</div>
                  <div className="text-xl font-bold text-white mt-1">{simulation.shardsInvolved.length}</div>
                  <div className="text-[10px] text-teal-400 mt-1">
                    {simulation.shardsInvolved.map((s) => `#${s}`).join(", ")}
                  </div>
                </div>
              </div>

              {/* Deposit Address Card */}
              {simulation.depositAddress && (
                <div className="bg-[#111827] border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Deposit Address (from live quote)</p>
                    <p className="text-xs font-mono text-emerald-400 truncate mt-0.5">{simulation.depositAddress}</p>
                    {simulation.deadline && (
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Expires: {new Date(simulation.deadline).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                  <a
                    href={`https://app.near-intents.org/?depositAddress=${simulation.depositAddress}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
                    title="View on NEAR Intents Explorer"
                  >
                    <ExternalLink className="w-4 h-4 text-gray-400" />
                  </a>
                </div>
              )}

              {/* Receipt Trace */}
              <div className="bg-[#111827] border border-gray-800 rounded-2xl p-6 shadow-xl">
                <h3 className="text-md font-bold text-white mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-teal-400" />
                    Multi-Shard Receipt Trace
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    {simulation.apiError ? "⚠ estimated" : "✓ live data"}
                  </span>
                </h3>

                <div className="space-y-3">
                  {simulation.receiptTrace.map((t) => (
                    <div key={t.step} className="p-3 bg-[#0a0f1d] border border-gray-800 rounded-xl flex items-start gap-3">
                      <div className={`px-2 py-1 rounded-md text-[10px] font-bold flex-shrink-0 mt-0.5 border ${
                        t.status === "SUCCESS" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                        t.status === "WARNING" ? "bg-amber-500/10  text-amber-400  border-amber-500/30"  :
                        "bg-red-500/10 text-red-400 border-red-500/30"
                      }`}>
                        S{t.shardId ?? 0}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-white truncate">{t.action}</span>
                          <span className="text-[10px] text-gray-600 flex-shrink-0">0{t.step}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5 break-all">{t.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* MCP Panel */}
              <McpPanel />
            </>
          )}

          {/* ── Live Intent Status Tracker ───────────────────────────────── */}
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-6 shadow-xl">
            <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
              <Radio className="w-5 h-5 text-purple-400" />
              Live Intent Status Tracker
              {isPolling && (
                <span className="ml-auto flex items-center gap-1.5 text-[10px] text-purple-400 font-normal">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  Polling every 8s
                </span>
              )}
            </h3>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={trackAddress}
                onChange={(e) => setTrackAddress(e.target.value)}
                placeholder="Paste deposit address from quote…"
                className="flex-1 bg-[#0a0f1d] border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-purple-500"
              />
              {isPolling ? (
                <button onClick={handleStopPolling}
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold rounded-lg transition flex-shrink-0">
                  Stop
                </button>
              ) : (
                <button onClick={handleStartPolling} disabled={!trackAddress.trim()}
                  className="px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-purple-500/30 text-purple-400 text-xs font-semibold rounded-lg transition flex-shrink-0">
                  Track
                </button>
              )}
            </div>

            {pollError && (
              <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                {pollError}
              </div>
            )}

            {intentStatus && (
              <div className={`p-4 rounded-xl border ${statusBg(intentStatus.status)}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-sm font-bold ${statusColor(intentStatus.status)}`}>
                    {intentStatus.status ?? "UNKNOWN"}
                  </span>
                  {intentStatus.timestamp && (
                    <span className="text-[10px] text-gray-500">
                      {new Date(intentStatus.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-[11px] text-gray-400">
                  {intentStatus.txHash && (
                    <p>TX Hash: <span className="font-mono text-gray-300 break-all">{intentStatus.txHash}</span></p>
                  )}
                  {intentStatus.amountIn && (
                    <p>Amount In (base units): <span className="font-mono text-gray-300">{intentStatus.amountIn}</span></p>
                  )}
                  {intentStatus.amountOut && (
                    <p>Amount Out (base units): <span className="font-mono text-gray-300">{intentStatus.amountOut}</span></p>
                  )}
                  <p className="pt-1">
                    <a
                      href={`https://app.near-intents.org/?depositAddress=${trackAddress}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-purple-400 hover:underline flex items-center gap-1"
                    >
                      View on NEAR Intents Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                </div>
              </div>
            )}

            {!intentStatus && !pollError && !isPolling && (
              <p className="text-xs text-gray-600 text-center py-4">
                Enter a deposit address to track live intent execution on NEAR Intents.
              </p>
            )}
          </div>

        </div>{/* end right col */}
      </div>
    </main>
  );
}
