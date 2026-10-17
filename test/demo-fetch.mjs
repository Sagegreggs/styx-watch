// Example-data fixtures for the public test console. Every scanned wallet here is fictional.
// The only real addresses are the OFAC-listed entries, which really are on the OFAC list.
const BTC = "bc1qstyxdemqwaterfqwxyz2345678qpzry9x8gf2tvdw0s3j";
const SOLW = "StyxDemoRiverWhaxe8888888888888888888888";
const BNBW = "0xdead00000000000000000000000000000000beef";
const OFAC_BTC = "123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX";
const S = 1e8;

const btcTx = (txid, vin, vout, t) => ({
  txid, status: { confirmed: true, block_time: t },
  vin: vin.map(([a, v]) => ({ is_coinbase: false, prevout: { scriptpubkey_address: a, value: Math.round(v * S) } })),
  vout: vout.map(([a, v]) => ({ scriptpubkey_address: a, value: Math.round(v * S) })),
});
const hex = (c) => c.repeat(64);

const SOL_TXS = [
  [+4200, "DemoFerrySourceAaaaaaaaaaaaaaaaaaaaaaaaa"], [-1850, "DemoMarshDestBbbbbbbbbbbbbbbbbbbbbbbbbb"],
  [+12500, "DemoDeltaInflowCccccccccccccccccccccccc"], [-640, "DemoReedDestDdddddddddddddddddddddddddd"],
  [+95, "DemoTrickleSrcEeeeeeeeeeeeeeeeeeeeeeeee"], [-3100, "DemoBankDestFfffffffffffffffffffffffffff"],
];
function solTx(k) {
  const [d, other] = SOL_TXS[k % SOL_TXS.length];
  const lam = Math.round(Math.abs(d) * 1e9);
  const [src, dst] = d > 0 ? [other, SOLW] : [SOLW, other];
  return {
    blockTime: 1792200000 - k * 5400,
    meta: { preBalances: [9e15, 9e15], postBalances: [9e15 + Math.sign(d) * lam, 9e15 - Math.sign(d) * lam], innerInstructions: [] },
    transaction: { message: { accountKeys: d > 0 ? [{ pubkey: SOLW }, { pubkey: other }] : [{ pubkey: SOLW }, { pubkey: other }],
      instructions: [{ program: "system", parsed: { type: "transfer", info: { source: src, destination: dst, lamports: lam } } }] } },
  };
}

function route(url, body) {
  const u = new URL(url), p = u.pathname;
  if (u.host === "mempool.space") {
    if (p.endsWith("/txs") && p.includes("/address/")) return [
      btcTx(hex("a"), [["bc1qdemqferrysrcqqqqqqqqqqqqqqqqqqqqqqqqqq", 300], ["3DemoAcheronSourcexxxxxxxxxxxx", 120.05]], [[BTC, 420], ["bc1qdemqchangeqqqqqqqqqqqqqqqqqqqqqqqqqq", 0.04]], 1792195000),
      btcTx(hex("b"), [[BTC, 160]], [["bc1qdemqmarshaqqqqqqqqqqqqqqqqqqqqqqqqqqq", 80], ["3DemoLetheDestxxxxxxxxxxxxxxx", 45.5], ["bc1qdemqreedsqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 30], [BTC, 4.49]], 1792181000),
      btcTx(hex("c"), [[OFAC_BTC, 12.8]], [[BTC, 12.75]], 1792160000),
      btcTx(hex("d"), [[BTC, 2.5]], [["bc1qdemqpondqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 2.4], [BTC, 0.099]], 1792133000),
      btcTx(hex("e"), [["3DemoTrickleSrcxxxxxxxxxxxxxx", 0.36]], [[BTC, 0.35]], 1792110000),
    ];
    if (p.includes("/address/")) return { chain_stats: { funded_txo_sum: 812.4 * S, spent_txo_sum: 498.15 * S, tx_count: 1482 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } };
    if (p === "/api/v1/blocks") return [{ id: hex("0"), timestamp: 1792200000 }];
    if (p === "/api/mempool/recent") return [{ txid: hex("f"), value: 64.2 * S }, { txid: hex("9"), value: 1.3 * S }];
    if (p.includes("/block/")) return [
      btcTx(hex("1"), [["1Coinbase", 0]], [["1DemoMiner", 3.13]], 1792200000),
      btcTx(hex("2"), [["bc1qdemqwhaleqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 1210]], [["bc1qdemqtoaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 700], ["3DemoToBxxxxxxxxxxxxxxxxxxxxxx", 400], ["bc1qdemqtocqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 109.9]], 1792200000),
      btcTx(hex("3"), [["3DemoFundxxxxxxxxxxxxxxxxxxxxx", 260]], [["bc1qdemqcoldqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 259.98]], 1792200000),
      btcTx(hex("4"), [["bc1qdemqsmallqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", 18]], [["3DemoDestSmallxxxxxxxxxxxxxxx", 17.99]], 1792200000),
    ];
  }
  if (u.host === "api.mainnet-beta.solana.com") {
    const { method, params } = JSON.parse(body);
    if (method === "getBalance") return { jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: 18420 * 1e9 } };
    if (method === "getSignaturesForAddress") {
      if (params[0] !== SOLW) return { jsonrpc: "2.0", id: 1, result: [] }; // no invented movements for real exchange wallets
      return { jsonrpc: "2.0", id: 1, result: Array.from({ length: 640 }, (_, i) => ({ signature: `DemoSig${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 88), err: null })) };
    }
    if (method === "getTransaction") return { jsonrpc: "2.0", id: 1, result: solTx(Number(String(params[0]).match(/\d+/)[0])) };
  }
  if (u.host === "free.rpc.fastnear.com") return { jsonrpc: "2.0", id: 1, result: { amount: "2350" + "0".repeat(24), locked: "0" } };
  if (u.host === "api.nearblocks.io") {
    if (p.endsWith("/count")) return { txns: [{ count: "37" }] };
    if (p === "/v1/txns") return { txns: [
      { transaction_hash: "DemoNearBig1", predecessor_account_id: "demo-whale.near", receiver_account_id: "demo-bridge.near", block_timestamp: "1792199000000000000", actions: [{ action: "TRANSFER", deposit: "1250000" + "0".repeat(24) }] },
      { transaction_hash: "DemoNearMid2", predecessor_account_id: "demo-fund.near", receiver_account_id: "demo-pool.near", block_timestamp: "1792198000000000000", actions: [{ action: "TRANSFER", deposit: "180000" + "0".repeat(24) }] },
      { transaction_hash: "DemoNearSm3", predecessor_account_id: "demo-a.near", receiver_account_id: "demo-b.near", block_timestamp: "1792197000000000000", actions: [{ action: "TRANSFER", deposit: "15000" + "0".repeat(24) }] },
    ] };
    return { txns: [
      { transaction_hash: "DemoNearTx1", predecessor_account_id: "demo-river.near", receiver_account_id: "styx-demo.near", block_timestamp: "1792190000000000000", actions: [{ action: "TRANSFER", deposit: "1200" + "0".repeat(24) }] },
      { transaction_hash: "DemoNearTx2", predecessor_account_id: "styx-demo.near", receiver_account_id: "demo-shop.near", block_timestamp: "1792150000000000000", actions: [{ action: "TRANSFER", deposit: "340" + "0".repeat(24) }] },
      { transaction_hash: "DemoNearTx3", predecessor_account_id: "styx-demo.near", receiver_account_id: "demo-dex.near", block_timestamp: "1792100000000000000", actions: [{ action: "FUNCTION_CALL", deposit: "25" + "0".repeat(24) }] },
    ] };
  }
  if (u.host === "bsc-dataseed.bnbchain.org") {
    const { method } = JSON.parse(body);
    if (method === "eth_getBalance") return { jsonrpc: "2.0", id: 1, result: "0x" + (32n * 10n ** 17n).toString(16) };
    if (method === "eth_getTransactionCount") return { jsonrpc: "2.0", id: 1, result: "0x9" };
    if (method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: 1, result: { timestamp: "0x6ad2cd40", transactions: [
      { hash: "0xdemo1", from: "0xdemo000000000000000000000000000000000a01", to: "0xdemo000000000000000000000000000000000b02", value: "0x" + (14500n * 10n ** 18n).toString(16) },
      { hash: "0xdemo2", from: "0xdemo000000000000000000000000000000000c03", to: "0xdemo000000000000000000000000000000000d04", value: "0x" + (2200n * 10n ** 18n).toString(16) },
      { hash: "0xdemo3", from: "0xdemo000000000000000000000000000000000e05", to: "0xdemo000000000000000000000000000000000f06", value: "0x" + (310n * 10n ** 18n).toString(16) },
    ] } };
  }
  if (u.host === "api.gopluslabs.io") return { code: 1, message: "ok", result: { cybercrime: "0", sanctioned: "0", phishing_activities: p.includes(BNBW) ? "1" : "0" } };
  if (u.host === "raw.githubusercontent.com") {
    if (p.includes("scamsniffer")) return [BNBW];
    if (p.endsWith("_XBT.txt")) return `${OFAC_BTC}\n`;
    if (p.endsWith("_SOL.txt")) return "FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC\n";
    if (p.endsWith("_BSC.txt")) return "0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c\n";
    return "";
  }
  return null;
}
globalThis.fetch = async (url, init) => {
  const d = route(String(url), init?.body);
  if (d === null) return new Response("not found", { status: 404 });
  return new Response(typeof d === "string" ? d : JSON.stringify(d), { status: 200 });
};
