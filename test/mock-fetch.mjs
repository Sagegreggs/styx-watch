// Preloaded with `node --import` to replace fetch with documented-shape fixtures.
const BTC = "bc1qtestwalletaddress0000000000000000000xyz";
const OFAC_BTC = "123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX";
const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const FAIL = process.env.MOCK_FAIL ?? "";

const btcTx = (txid, vin, vout, t) => ({
  txid,
  status: { confirmed: true, block_time: t },
  vin: vin.map(([a, v]) => ({ is_coinbase: false, prevout: { scriptpubkey_address: a, value: v } })),
  vout: vout.map(([a, v]) => ({ scriptpubkey_address: a, value: v })),
});

function solTx(owner, delta, dest) {
  return {
    blockTime: 1760650000,
    meta: { preBalances: [5e15, 0], postBalances: [5e15 + delta, -delta], innerInstructions: [] },
    transaction: {
      message: {
        accountKeys: [{ pubkey: owner }, { pubkey: dest }],
        instructions: [{ program: "system", parsed: { type: "transfer", info: { source: owner, destination: dest, lamports: -delta } } }],
      },
    },
  };
}

function route(url, body) {
  const u = new URL(url);
  if (FAIL && u.host.includes(FAIL)) throw new Error("mock network down");
  const p = u.pathname;
  if (u.host === "mempool.space") {
    if (p.endsWith("/txs") && p.includes("/address/")) {
      return [
        btcTx("a".repeat(64), [[OFAC_BTC, 150e8]], [[BTC, 149.9e8]], 1760600000),
        btcTx("f".repeat(64), [["1DustSpammer1111111111111111111", 0.5e8]], [[BTC, 546], ["1DustSpammer1111111111111111111", 0.4999e8]], 1760605000),
        btcTx("b".repeat(64), [[BTC, 50e8]], [["3Dest1aaaaaaaaaaaaaaaaaaaaaaaaaaaa", 20e8], ["3Dest2bbbbbbbbbbbbbbbbbbbbbbbbbbbb", 25e8], [BTC, 4.99e8]], 1760610000),
      ];
    }
    if (p.includes("/address/")) return { chain_stats: { funded_txo_sum: 200e8, spent_txo_sum: 50e8, tx_count: 1234 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } };
    if (p === "/api/v1/blocks") return [{ id: "0".repeat(64), timestamp: 1760650000 }];
    if (p === "/api/mempool/recent") return [{ txid: "c".repeat(64), fee: 1000, vsize: 200, value: 3.2e8 }];
    if (p.includes("/block/")) return [btcTx("d".repeat(64), [["1Coinbase", 0]], [["1Miner", 3.1e8]], 1760650000), btcTx("e".repeat(64), [["1Whale1111111111111111111111111", 520e8]], [["1To", 300e8], ["1To2", 219e8]], 1760650000)];
  }
  if (u.host === "api.mainnet-beta.solana.com") {
    const { method, params } = JSON.parse(body);
    if (method === "getBalance") return { jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: 11_175_972e9 } };
    if (method === "getSignaturesForAddress") return { jsonrpc: "2.0", id: 1, result: Array.from({ length: params[1].limit }, (_, i) => ({ signature: `sig${params[0].slice(0, 4)}${i}`, err: null })) };
    if (method === "getTransaction") return { jsonrpc: "2.0", id: 1, result: solTx(params[0].includes("9WzD") ? SOL : params[0].slice(3, 7) === "5tzF" ? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9" : "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", -25_000e9, "FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC") };
  }
  if (u.host === "free.rpc.fastnear.com") return { jsonrpc: "2.0", id: 1, result: { amount: "11270000000000000000000000000000", locked: "0" } };
  if (u.host === "api.nearblocks.io") {
    const txns = [
      { transaction_hash: "NearTx1", predecessor_account_id: "relay.aurora", receiver_account_id: "aurora", block_timestamp: "1760650000000000000", actions: [{ action: "TRANSFER", deposit: "250000000000000000000000000000" }] },
      { transaction_hash: "NearTx2", predecessor_account_id: "bob.near", receiver_account_id: "relay.aurora", block_timestamp: "1760640000000000000", actions: [{ action: "FUNCTION_CALL", deposit: "0" }] },
    ];
    if (p.endsWith("/count")) return { txns: [{ count: "48210" }] };
    return { txns };
  }
  if (u.host === "bsc-dataseed.bnbchain.org") {
    const { method } = JSON.parse(body);
    if (method === "eth_getBalance") return { jsonrpc: "2.0", id: 1, result: "0x" + (1_739_974n * 10n ** 18n).toString(16) };
    if (method === "eth_getTransactionCount") return { jsonrpc: "2.0", id: 1, result: "0x2a" };
    if (method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: 1, result: { timestamp: "0x68f0a000", transactions: [{ hash: "0xbig", from: "0xF977814e90dA44bFA03b6295A0616a897441aceC", to: "0xabc", value: "0x" + (12_000n * 10n ** 18n).toString(16) }, { hash: "0xsmall", from: "0x1", to: "0x2", value: "0x1" }] } };
  }
  if (u.host === "api.gopluslabs.io") return { code: 1, message: "ok", result: { cybercrime: "0", phishing_activities: u.pathname.includes("0x4f47") ? "1" : "0", sanctioned: "0" } };
  if (u.host === "raw.githubusercontent.com") {
    if (p.includes("scamsniffer")) return ["0x101ce0cedd142f199c9ef61739ae59b6611a0fc0"];
    if (p.endsWith("_XBT.txt")) return `${OFAC_BTC}\n`;
    if (p.endsWith("_SOL.txt")) return "FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC\n";
    if (p.endsWith("_BSC.txt")) return "0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c\n";
    return "";
  }
  return null;
}

globalThis.fetch = async (url, init) => {
  const data = route(String(url), init?.body);
  if (data === null) return new Response("not found", { status: 404 });
  return new Response(typeof data === "string" ? data : JSON.stringify(data), { status: 200 });
};
