// Scam and sanctions screening. Sources:
// - OFAC SDN digital-currency addresses, mirrored daily by 0xB10C on GitHub
// - ScamSniffer public EVM blacklist (published with a 7-day delay)
// - GoPlus address security flags (BNB Chain and Solana only)
import { getJson } from "./chains.js";
import { HOSTS, normalize, type Chain } from "./registry.js";

const OFAC = `https://${HOSTS.github}/0xB10C/ofac-sanctioned-digital-currency-addresses/lists`;
const SCAMSNIFFER = `https://${HOSTS.github}/scamsniffer/scam-database/main/blacklist/address.json`;
const GOPLUS = `https://${HOSTS.goplus}/api/v1/address_security`;

const OFAC_TICKERS: Record<Chain, string[]> = {
  bitcoin: ["XBT"],
  solana: ["SOL"],
  bnb: ["BSC", "ETH", "USDT"],
  near: [],
};

export const GOPLUS_FLAGS = [
  "cybercrime",
  "money_laundering",
  "financial_crime",
  "phishing_activities",
  "stealing_attack",
  "blackmail_activities",
  "darkweb_transactions",
  "sanctioned",
  "mixer",
  "honeypot_related_address",
  "fake_kyc",
  "malicious_mining_activities",
  "blacklist_doubt",
] as const;

async function text(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3_500) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export interface RiskLists {
  sanctioned: Set<string>;
  scamSniffer: Set<string>;
  sources: string[];
  unavailable: string[];
}

export async function loadLists(chain: Chain): Promise<RiskLists> {
  const lists: RiskLists = { sanctioned: new Set(), scamSniffer: new Set(), sources: [], unavailable: [] };
  const jobs: Promise<void>[] = OFAC_TICKERS[chain].map(async (t) => {
    try {
      for (const line of (await text(`${OFAC}/sanctioned_addresses_${t}.txt`)).split(/\r?\n/)) {
        const a = line.trim();
        if (a) lists.sanctioned.add(normalize(chain, a));
      }
      lists.sources.push(`OFAC ${t}`);
    } catch {
      lists.unavailable.push(`OFAC ${t}`);
    }
  });
  if (chain === "bnb") {
    jobs.push(
      (async () => {
        try {
          const arr = await getJson<string[]>(SCAMSNIFFER);
          for (const a of arr) lists.scamSniffer.add(a.toLowerCase());
          lists.sources.push("ScamSniffer");
        } catch {
          lists.unavailable.push("ScamSniffer");
        }
      })(),
    );
  }
  await Promise.all(jobs);
  return lists;
}

export function listFlags(lists: RiskLists, chain: Chain, address: string): string[] {
  const a = normalize(chain, address);
  const flags: string[] = [];
  if (lists.sanctioned.has(a)) flags.push("OFAC sanctioned");
  if (lists.scamSniffer.has(a)) flags.push("ScamSniffer blacklist");
  return flags;
}

export async function goplusFlags(chain: Chain, address: string): Promise<{ flags: string[]; checked: boolean }> {
  const id = chain === "bnb" ? "56" : chain === "solana" ? "solana" : null;
  if (!id) return { flags: [], checked: false };
  try {
    const body = await getJson<any>(`${GOPLUS}/${address}?chain_id=${id}`);
    const r = body?.result ?? {};
    return { flags: GOPLUS_FLAGS.filter((f) => String(r[f]) === "1").map((f) => `GoPlus: ${f.replace(/_/g, " ")}`), checked: body?.code === 1 };
  } catch {
    return { flags: [], checked: false };
  }
}
