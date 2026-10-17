// River Styx classification and the text "river map" PayBox shows to the user.
import { CHAIN_INFO, type Chain } from "./registry.js";

export type FlowTier = "trickle" | "rivulet" | "stream" | "main stream";

export interface Split {
  address: string;
  amount: number;
}

export interface Flow {
  txid: string;
  time: string | null;
  direction: "in" | "out" | "self";
  amount: number;
  tier: FlowTier;
  splits: Split[];
}

export interface Association {
  address: string;
  label: string | null;
  inflow: number;
  outflow: number;
  txs: number;
  flags: string[];
}

export interface Health {
  txCount: number;
  exact: boolean;
  status: "dry" | "poor" | "healthy" | "underdog" | "overscaled";
  nickname: string;
  flow: string;
}

export interface Reservoir {
  balance: number;
  form: "dry bed" | "puddle" | "pond" | "lake" | "great lake" | "abyss";
  name: string;
}

/** Health tiers by transaction count. Over 100 is healthy, over 1,000 is the Underdog. */
export const HEALTH_TIERS = [
  { min: 0, max: 0, status: "dry", nickname: "Lethe's Dry Bed", flow: "·" },
  { min: 1, max: 99, status: "poor", nickname: "Shade's Trickle", flow: "·˙·˙·" },
  { min: 100, max: 999, status: "healthy", nickname: "Ferryman's Current", flow: "≈≈≈≈≈≈" },
  { min: 1_000, max: 9_999, status: "underdog", nickname: "The Underdog", flow: "≋≋≋≋≋≋≋≋" },
  { min: 10_000, max: 99_999, status: "overscaled", nickname: "Cerberus Torrent", flow: "≋≋≋≋≋≋≋≋≋≋" },
  { min: 100_000, max: 999_999, status: "overscaled", nickname: "Acheron Flood", flow: "≋≋≋≋≋≋≋≋≋≋≋≋" },
  { min: 1_000_000, max: Number.MAX_SAFE_INTEGER, status: "overscaled", nickname: "Leviathan of Hades", flow: "≋≋≋≋≋≋≋≋≋≋≋≋≋≋" },
] as const;

export function health(txCount: number, exact: boolean): Health {
  const tier = HEALTH_TIERS.find((t) => txCount >= t.min && txCount <= t.max) ?? HEALTH_TIERS[0];
  return { txCount, exact, status: tier.status, nickname: tier.nickname, flow: tier.flow };
}

export function flowTier(chain: Chain, amount: number): FlowTier {
  const [rivulet, stream, main] = CHAIN_INFO[chain].flow;
  const a = Math.abs(amount);
  if (a >= main) return "main stream";
  if (a >= stream) return "stream";
  if (a >= rivulet) return "rivulet";
  return "trickle";
}

export function reservoir(chain: Chain, balance: number): Reservoir {
  const [rivulet, stream, main] = CHAIN_INFO[chain].flow;
  if (balance <= 0) return { balance, form: "dry bed", name: "Dry riverbed" };
  if (balance < rivulet) return { balance, form: "puddle", name: "Puddle of Lethe" };
  if (balance < stream) return { balance, form: "pond", name: "Pond of Shades" };
  if (balance < main) return { balance, form: "lake", name: "Lake Avernus" };
  if (balance < main * 10) return { balance, form: "great lake", name: "Great Marsh of Acheron" };
  return { balance, form: "abyss", name: "Abyss of Tartarus" };
}

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const tiny = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
export const fmt = (n: number) => (n !== 0 && Math.abs(n) < 0.0001 ? tiny.format(n) : nf.format(n));
export const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const TIER_LINE: Record<FlowTier, string> = {
  "main stream": "━━━━━━━",
  stream: "━━━━",
  rivulet: "──",
  trickle: "┈",
};

export function renderFlow(chain: Chain, f: Flow, maxSplits = 4): string[] {
  const sym = CHAIN_INFO[chain].symbol;
  const arrow = f.direction === "in" ? "⇠ in " : f.direction === "out" ? "⇢ out" : "↻ self";
  const when = f.time ? f.time.slice(0, 16).replace("T", " ") : "pending";
  const lines = [`${TIER_LINE[f.tier]} ${f.tier.toUpperCase()} ${arrow} ${fmt(f.amount)} ${sym} · ${when} · ${short(f.txid)}`];
  const splits = f.splits.slice(0, maxSplits);
  splits.forEach((s, i) => {
    const elbow = i === splits.length - 1 && f.splits.length <= maxSplits ? "└" : "├";
    lines.push(`    ${elbow}── tributary ${fmt(s.amount)} ${sym} ${f.direction === "in" ? "from" : "→"} ${short(s.address)}`);
  });
  if (f.splits.length > maxSplits) lines.push(`    └── +${f.splits.length - maxSplits} more waterways`);
  return lines;
}
