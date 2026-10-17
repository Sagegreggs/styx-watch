// Chain readers. Every call is bounded so a whole tool call fits PayBox's 10 s budget.
import { CHAIN_INFO, HOSTS, normalize, type Chain } from "./registry.js";
import { flowTier, type Flow, type Split } from "./styx.js";

const TIMEOUT_MS = 3_500;

export async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function rpc<T = any>(url: string, method: string, params: unknown): Promise<T> {
  const body = await getJson<{ result?: T; error?: { message?: string } }>(url, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (body.error || body.result === undefined) throw new Error(`${method}: ${body.error?.message ?? "no result"}`);
  return body.result;
}

/** Integer base units (string/bigint/number) → native units as a JS number. */
export function toUnits(raw: string | number | bigint | null | undefined, decimals: number): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  let v: bigint;
  try {
    v = typeof raw === "bigint" ? raw : BigInt(typeof raw === "number" ? Math.trunc(raw) : raw);
  } catch {
    return 0;
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const scale = 10n ** BigInt(decimals);
  const whole = Number(v / scale);
  const frac = Number(v % scale) / Number(scale);
  return (neg ? -1 : 1) * (whole + frac);
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

export interface WalletData {
  balance: number;
  txCount: number;
  txCountExact: boolean;
  flows: Flow[];
  notes: string[];
}

function mkFlow(chain: Chain, txid: string, time: string | null, net: number, splits: Split[]): Flow {
  const direction = net > 0 ? "in" : net < 0 ? "out" : "self";
  splits.sort((a, b) => b.amount - a.amount);
  return { txid, time, direction, amount: Math.abs(net), tier: flowTier(chain, net), splits };
}

// ---------------- Bitcoin (mempool.space, open-source Esplora API) ----------------
const MEMPOOL = `https://${HOSTS.mempool}/api`;

export function btcFlow(tx: any, address: string): Flow {
  let spent = 0;
  let received = 0;
  const sources = new Map<string, number>();
  const dests = new Map<string, number>();
  for (const vin of tx.vin ?? []) {
    const a = vin.prevout?.scriptpubkey_address;
    const v = Number(vin.prevout?.value ?? 0);
    if (a === address) spent += v;
    else if (a) sources.set(a, (sources.get(a) ?? 0) + v);
  }
  for (const vout of tx.vout ?? []) {
    const a = vout.scriptpubkey_address;
    const v = Number(vout.value ?? 0);
    if (a === address) received += v;
    else if (a) dests.set(a, (dests.get(a) ?? 0) + v);
  }
  const net = (received - spent) / 1e8;
  const pool = net >= 0 ? sources : dests;
  // Attribute only this wallet's share: a deposit is funded pro rata by every other input,
  // and a payment pro rata reaches every other output.
  const poolTotal = [...pool.values()].reduce((x, y) => x + y, 0);
  const share = poolTotal > 0 ? Math.min(1, (Math.abs(net) * 1e8) / poolTotal) : 0;
  const splits = [...pool].map(([a, v]) => ({ address: a, amount: (v * share) / 1e8 }));
  return mkFlow("bitcoin", tx.txid, iso(tx.status?.block_time), net, splits);
}

async function scanBitcoin(address: string): Promise<WalletData> {
  const [info, txs] = await Promise.all([
    getJson(`${MEMPOOL}/address/${address}`),
    getJson<any[]>(`${MEMPOOL}/address/${address}/txs`).catch(() => [] as any[]),
  ]);
  const c = info.chain_stats ?? {};
  const m = info.mempool_stats ?? {};
  const balanceSats = (c.funded_txo_sum ?? 0) - (c.spent_txo_sum ?? 0) + (m.funded_txo_sum ?? 0) - (m.spent_txo_sum ?? 0);
  return {
    balance: balanceSats / 1e8,
    txCount: (c.tx_count ?? 0) + (m.tx_count ?? 0),
    txCountExact: true,
    flows: txs.slice(0, 25).map((tx) => btcFlow(tx, address)),
    notes: [],
  };
}

// ---------------- Solana (public JSON-RPC) ----------------
const SOLANA = `https://${HOSTS.solana}`;

export function solFlow(tx: any, address: string, signature: string): Flow | null {
  if (!tx?.meta || !tx.transaction?.message) return null;
  const keys: string[] = (tx.transaction.message.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
  const i = keys.indexOf(address);
  if (i < 0) return null;
  const pre: number[] = tx.meta.preBalances ?? [];
  const post: number[] = tx.meta.postBalances ?? [];
  const net = ((post[i] ?? 0) - (pre[i] ?? 0)) / 1e9;
  const splits = new Map<string, number>();
  const instructions = [
    ...(tx.transaction.message.instructions ?? []),
    ...(tx.meta.innerInstructions ?? []).flatMap((x: any) => x.instructions ?? []),
  ];
  for (const ix of instructions) {
    const p = ix?.parsed;
    if (ix?.program !== "system" || !p || (p.type !== "transfer" && p.type !== "transferWithSeed")) continue;
    const { source, destination, lamports } = p.info ?? {};
    const amt = Number(lamports ?? 0) / 1e9;
    if (source === address && destination) splits.set(destination, (splits.get(destination) ?? 0) + amt);
    if (destination === address && source) splits.set(source, (splits.get(source) ?? 0) + amt);
  }
  if (splits.size === 0) {
    keys.forEach((k, j) => {
      if (j === i) return;
      const d = ((post[j] ?? 0) - (pre[j] ?? 0)) / 1e9;
      if (d !== 0 && Math.sign(d) !== Math.sign(net)) splits.set(k, Math.abs(d));
    });
  }
  return mkFlow("solana", signature, iso(tx.blockTime), net, [...splits].map(([a, v]) => ({ address: a, amount: v })));
}

async function solTransactions(signatures: string[]): Promise<any[]> {
  return Promise.all(
    signatures.map((s) =>
      rpc(SOLANA, "getTransaction", [s, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null),
    ),
  );
}

async function scanSolana(address: string): Promise<WalletData> {
  const [bal, sigs] = await Promise.all([
    rpc<{ value: number }>(SOLANA, "getBalance", [address]),
    rpc<any[]>(SOLANA, "getSignaturesForAddress", [address, { limit: 1000 }]).catch(() => [] as any[]),
  ]);
  const recent = sigs.slice(0, 8).map((s) => s.signature as string);
  const txs = await solTransactions(recent);
  const flows = txs.map((tx, k) => solFlow(tx, address, recent[k]!)).filter((f): f is Flow => f !== null);
  return {
    balance: bal.value / 1e9,
    txCount: sigs.length,
    txCountExact: sigs.length < 1000,
    flows,
    notes: sigs.length >= 1000 ? ["Solana count is a lower bound: the public RPC returns at most 1,000 signatures per page."] : [],
  };
}

// ---------------- NEAR (FastNEAR / NEAR RPC + NearBlocks) ----------------
const NEARBLOCKS = `https://${HOSTS.nearblocks}/v1`;

async function nearRpc<T>(method: string, params: unknown): Promise<T> {
  try {
    return await rpc<T>(`https://${HOSTS.nearRpc}`, method, params);
  } catch {
    return rpc<T>(`https://${HOSTS.nearRpcFallback}`, method, params);
  }
}

export function nearFlow(t: any, account: string): Flow {
  const actions: any[] = t.actions ?? [];
  let yocto = 0n;
  for (const a of actions) {
    try {
      yocto += BigInt(a.deposit ?? 0);
    } catch {
      /* non-integer deposit field */
    }
  }
  if (yocto === 0n && t.actions_agg?.deposit !== undefined) {
    try {
      yocto = BigInt(String(t.actions_agg.deposit).split(".")[0] ?? "0");
    } catch {
      /* ignore */
    }
  }
  const amount = toUnits(yocto, 24);
  const from = String(t.predecessor_account_id ?? t.signer_account_id ?? "");
  const to = String(t.receiver_account_id ?? "");
  const outgoing = from.toLowerCase() === account;
  const other = outgoing ? to : from;
  const net = from === to ? 0 : outgoing ? -amount : amount;
  const ts = t.block_timestamp ?? t.receipt_block?.block_timestamp;
  const time = ts ? new Date(Number(BigInt(String(ts)) / 1_000_000n)).toISOString() : null;
  return mkFlow("near", String(t.transaction_hash ?? t.receipt_id ?? ""), time, net, other && amount > 0 ? [{ address: other, amount }] : []);
}

async function scanNear(account: string): Promise<WalletData> {
  const notes: string[] = [];
  const [view, txns, count] = await Promise.all([
    nearRpc<any>("query", { request_type: "view_account", finality: "final", account_id: account }),
    getJson<any>(`${NEARBLOCKS}/account/${account}/txns?per_page=25`).catch(() => {
      notes.push("NearBlocks history unavailable (free tier allows 6 calls/minute); flows omitted.");
      return { txns: [] };
    }),
    getJson<any>(`${NEARBLOCKS}/account/${account}/txns/count`).catch(() => null),
  ]);
  const list: any[] = txns?.txns ?? [];
  const counted = Number(count?.txns?.[0]?.count ?? count?.count ?? NaN);
  return {
    balance: toUnits(view.amount, 24),
    txCount: Number.isFinite(counted) ? counted : list.length,
    txCountExact: Number.isFinite(counted),
    flows: list.map((t) => nearFlow(t, account)),
    notes,
  };
}

// ---------------- BNB Smart Chain (public RPC, keyless) ----------------
const BSC = `https://${HOSTS.bsc}`;

async function scanBnb(address: string): Promise<WalletData> {
  const [bal, nonce] = await Promise.all([
    rpc<string>(BSC, "eth_getBalance", [address, "latest"]),
    rpc<string>(BSC, "eth_getTransactionCount", [address, "latest"]),
  ]);
  return {
    balance: toUnits(BigInt(bal), 18),
    txCount: Number(BigInt(nonce)),
    txCountExact: false,
    flows: [],
    notes: [
      "BNB count is outgoing transactions only (account nonce); incoming transfers are not counted.",
      "Per-address BNB history needs an Etherscan V2 key, so keyless mode shows balance, count and risk only.",
    ],
  };
}

export async function scanWallet(chain: Chain, address: string): Promise<WalletData> {
  switch (chain) {
    case "bitcoin":
      return scanBitcoin(address);
    case "solana":
      return scanSolana(address);
    case "near":
      return scanNear(normalize("near", address));
    case "bnb":
      return scanBnb(address);
  }
}

// ---------------- Large movements ("currents") ----------------
export interface Current {
  chain: Chain;
  txid: string;
  time: string | null;
  amount: number;
  tier: string;
  from: string | null;
  to: string | null;
  splits: number;
}

export async function btcCurrents(): Promise<Current[]> {
  const blocks = await getJson<any[]>(`${MEMPOOL}/v1/blocks`);
  const tip = blocks[0];
  const [recent, page] = await Promise.all([
    getJson<any[]>(`${MEMPOOL}/mempool/recent`).catch(() => [] as any[]),
    tip ? getJson<any[]>(`${MEMPOOL}/block/${tip.id}/txs/0`).catch(() => [] as any[]) : Promise.resolve([] as any[]),
  ]);
  const out: Current[] = [];
  for (const tx of page) {
    if (tx.vin?.[0]?.is_coinbase) continue;
    const outs: any[] = tx.vout ?? [];
    const amount = outs.reduce((s, o) => s + Number(o.value ?? 0), 0) / 1e8;
    out.push({
      chain: "bitcoin",
      txid: tx.txid,
      time: iso(tx.status?.block_time ?? tip?.timestamp),
      amount,
      tier: flowTier("bitcoin", amount),
      from: tx.vin?.[0]?.prevout?.scriptpubkey_address ?? null,
      to: outs[0]?.scriptpubkey_address ?? null,
      splits: outs.length,
    });
  }
  for (const tx of recent) {
    const amount = Number(tx.value ?? 0) / 1e8;
    out.push({ chain: "bitcoin", txid: tx.txid, time: null, amount, tier: flowTier("bitcoin", amount), from: null, to: null, splits: 0 });
  }
  return out;
}

export async function bnbCurrents(): Promise<Current[]> {
  const block = await rpc<any>(BSC, "eth_getBlockByNumber", ["latest", true]);
  const time = iso(Number(BigInt(block.timestamp ?? "0x0")));
  return (block.transactions ?? []).map((tx: any) => {
    const amount = toUnits(BigInt(tx.value ?? "0x0"), 18);
    return { chain: "bnb" as const, txid: tx.hash, time, amount, tier: flowTier("bnb", amount), from: tx.from ?? null, to: tx.to ?? null, splits: 1 };
  });
}

export async function solCurrents(watch: string[]): Promise<Current[]> {
  const sigLists = await Promise.all(
    watch.map((a) => rpc<any[]>(SOLANA, "getSignaturesForAddress", [a, { limit: 4 }]).catch(() => [] as any[])),
  );
  const pairs = watch.flatMap((a, i) => (sigLists[i] ?? []).filter((s) => !s.err).map((s) => ({ a, sig: s.signature as string })));
  const txs = await solTransactions(pairs.map((p) => p.sig));
  const out: Current[] = [];
  txs.forEach((tx, k) => {
    const p = pairs[k]!;
    const f = solFlow(tx, p.a, p.sig);
    if (!f) return;
    const top = f.splits[0]?.address ?? null;
    out.push({
      chain: "solana",
      txid: p.sig,
      time: f.time,
      amount: f.amount,
      tier: f.tier,
      from: f.direction === "out" ? p.a : top,
      to: f.direction === "out" ? top : p.a,
      splits: f.splits.length,
    });
  });
  return out;
}

export async function nearCurrents(): Promise<Current[]> {
  const body = await getJson<any>(`${NEARBLOCKS}/txns?per_page=25`);
  return (body.txns ?? []).map((t: any) => {
    const f = nearFlow(t, String(t.receiver_account_id ?? "").toLowerCase());
    return {
      chain: "near" as const,
      txid: f.txid,
      time: f.time,
      amount: f.amount,
      tier: f.tier,
      from: t.predecessor_account_id ?? null,
      to: t.receiver_account_id ?? null,
      splits: (t.actions ?? []).length,
    };
  });
}

export const chainSymbol = (c: Chain) => CHAIN_INFO[c].symbol;
