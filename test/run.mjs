// Calls the bundled plugin over stdio with mocked network and checks behaviour.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const bundle = resolve("dist/plugin.mjs");
const mock = resolve("test/mock-fetch.mjs");
const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

function call(name, args, env = {}) {
  return new Promise((res, rej) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--import", mock, bundle], { env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const nl = out.indexOf("\n");
      if (nl >= 0) { child.kill(); res({ msg: JSON.parse(out.slice(0, nl)), ms: Date.now() - started }); }
    });
    child.on("close", () => rej(new Error("closed without answer")));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: meta } }) + "\n");
  });
}

const results = [];
async function check(label, fn) {
  try { await fn(); results.push(`PASS ${label}`); } catch (e) { results.push(`FAIL ${label}: ${e.message}`); process.exitCode = 1; }
}

await check("bitcoin scan: health, lake, tributaries, OFAC-tainted associate", async () => {
  const { msg } = await call("styx_scan_wallet", { address: "bc1qtestwalletaddress0000000000000000000xyz" });
  const s = msg.result.structuredContent;
  assert.equal(s.chain, "bitcoin");
  assert.equal(s.health.nickname, "The Underdog");
  assert.equal(s.reservoir.form, "great lake");
  assert.equal(s.flows[0].tier, "main stream");
  assert.equal(s.flows[1].direction, "out");
  assert.equal(s.flows[1].splits.length, 2);
  assert.equal(s.risk.verdict, "tainted");
  assert.ok(s.associations[0].flags.includes("OFAC sanctioned"));
  assert.equal(s.flows[0].splits[0].amount, 149.9, "incoming tributary shows only the share received");
  assert.equal(s.flows.length, 2, "dust drop is grouped, not listed");
  assert.ok(s.notes[0].startsWith("1 dust drop"));
  assert.ok(msg.result.content[0].text.includes("0.00000546 BTC"));
  console.log(msg.result.content[0].text + "\n");
});

await check("solana scan: lower-bound count, SOL tributary to sanctioned wallet", async () => {
  const { msg } = await call("styx_scan_wallet", { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
  const s = msg.result.structuredContent;
  assert.equal(s.label, "Binance 3");
  assert.equal(s.health.exact, false);
  assert.equal(s.reservoir.form, "abyss");
  assert.equal(s.flows[0].amount, 25000);
  assert.equal(s.risk.verdict, "tainted");
});

await check("near scan: yocto conversion, count endpoint, no-list notice", async () => {
  const { msg } = await call("styx_scan_wallet", { address: "relay.aurora" });
  const s = msg.result.structuredContent;
  assert.equal(s.chain, "near");
  assert.equal(s.reservoir.balance, 11270000);
  assert.equal(s.health.txCount, 48210);
  assert.equal(s.health.nickname, "Cerberus Torrent");
  assert.equal(s.flows[0].amount, 250000);
  assert.ok(s.risk.unavailable.some((x) => x.includes("NEAR")));
});

await check("bnb scan: sanctioned wallet is damned", async () => {
  const { msg } = await call("styx_scan_wallet", { address: "0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c" });
  const s = msg.result.structuredContent;
  assert.equal(s.risk.verdict, "damned");
  assert.ok(s.risk.walletFlags.includes("OFAC sanctioned"));
  assert.ok(s.risk.walletFlags.some((f) => f.startsWith("GoPlus")));
  assert.equal(s.health.status, "poor");
});

await check("currents: ranked across chains", async () => {
  const { msg, ms } = await call("styx_currents", {});
  const s = msg.result.structuredContent;
  assert.ok(s.perChain.every((c) => c.ok));
  assert.equal(s.currents[0].tier, "main stream");
  console.log(msg.result.content[0].text + `\n(${ms} ms)\n`);
});

await check("currents: one network down still returns the rest", async () => {
  const { msg } = await call("styx_currents", {}, { MOCK_FAIL: "mempool.space" });
  const s = msg.result.structuredContent;
  assert.equal(s.perChain.find((c) => c.chain === "bitcoin").ok, false);
  assert.ok(s.currents.length > 0);
});

await check("scan: unreachable source gives a clear error, not a crash", async () => {
  const { msg } = await call("styx_scan_wallet", { address: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo" }, { MOCK_FAIL: "mempool.space" });
  assert.equal(msg.result.isError, true);
});

await check("scan: unknown address format is rejected", async () => {
  const { msg } = await call("styx_scan_wallet", { address: "not-a-wallet!!" });
  assert.equal(msg.result.isError, true);
});

console.log(results.join("\n"));
