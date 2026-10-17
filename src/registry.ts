// Static reference data for the Styx watcher. Labels come from public explorer
// name tags (bitinfocharts rich list, Solscan, Etherscan/BscScan) checked on
// 2026-10-17. They are labels, not proof of ownership.

export type Chain = "bitcoin" | "solana" | "near" | "bnb";
export const CHAINS: readonly Chain[] = ["bitcoin", "solana", "near", "bnb"];

export interface ChainInfo {
  symbol: string;
  decimals: number;
  /** Native-unit thresholds: [rivulet, stream, main stream]. */
  flow: [number, number, number];
  explorer: (address: string) => string;
}

export const CHAIN_INFO: Record<Chain, ChainInfo> = {
  bitcoin: {
    symbol: "BTC",
    decimals: 8,
    flow: [1, 10, 100],
    explorer: (a) => `https://mempool.space/address/${a}`,
  },
  solana: {
    symbol: "SOL",
    decimals: 9,
    flow: [1_000, 10_000, 100_000],
    explorer: (a) => `https://solscan.io/account/${a}`,
  },
  near: {
    symbol: "NEAR",
    decimals: 24,
    flow: [10_000, 100_000, 1_000_000],
    explorer: (a) => `https://nearblocks.io/address/${a}`,
  },
  bnb: {
    symbol: "BNB",
    decimals: 18,
    flow: [100, 1_000, 10_000],
    explorer: (a) => `https://bscscan.com/address/${a}`,
  },
};

export interface KnownWallet {
  chain: Chain;
  address: string;
  label: string;
  source: string;
}

export const KNOWN_WALLETS: KnownWallet[] = [
  { chain: "bitcoin", address: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo", label: "Binance cold wallet", source: "bitinfocharts.com rich list" },
  { chain: "bitcoin", address: "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6", label: "Binance cold wallet", source: "bitinfocharts.com rich list" },
  { chain: "bitcoin", address: "bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2", label: "Robinhood cold wallet", source: "bitinfocharts.com rich list" },
  { chain: "solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Binance 3", source: "Solscan label" },
  { chain: "solana", address: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", label: "Binance 2", source: "Solscan label" },
  { chain: "solana", address: "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", label: "Coinbase 1", source: "Solscan label" },
  { chain: "bnb", address: "0xF977814e90dA44bFA03b6295A0616a897441aceC", label: "Binance hot wallet 20", source: "Etherscan name tag" },
  { chain: "bnb", address: "0x631Fc1EA2270e98fbD9D92658eCe0F5a269Aa161", label: "Binance hot wallet", source: "BscScan label" },
  { chain: "bnb", address: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3", label: "Binance 51", source: "Etherscan name tag" },
];

export function normalize(chain: Chain, address: string): string {
  return chain === "bnb" || chain === "near" ? address.toLowerCase() : address;
}

export function knownLabel(chain: Chain, address: string): string | undefined {
  const a = normalize(chain, address);
  return KNOWN_WALLETS.find((w) => w.chain === chain && normalize(chain, w.address) === a)?.label;
}

/** Hostnames this plugin calls; configure all of them in the portal. */
export const HOSTS = {
  mempool: "mempool.space",
  solana: "api.mainnet-beta.solana.com",
  nearRpc: "free.rpc.fastnear.com",
  nearRpcFallback: "rpc.mainnet.near.org",
  nearblocks: "api.nearblocks.io",
  bsc: "bsc-dataseed.bnbchain.org",
  goplus: "api.gopluslabs.io",
  github: "raw.githubusercontent.com",
} as const;

export function detectChain(address: string): Chain | null {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "bnb";
  if (/^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a)) return "bitcoin";
  // NEAR account IDs: 2–64 chars, lowercase parts joined by dots (base58 never contains dots), or a 64-hex implicit account.
  const part = "(?:[a-z0-9]+[-_])*[a-z0-9]+";
  if (new RegExp(`^(?=.{2,64}$)${part}(?:\\.${part})+$`).test(a) || /^[0-9a-f]{64}$/.test(a)) return "near";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "solana";
  return null;
}
