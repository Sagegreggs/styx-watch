// Runs the real dist/plugin.mjs over stdio with example fixtures and records each tool result.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
function call(name, args) {
  return new Promise((res, rej) => {
    const t = Date.now();
    const c = spawn(process.execPath, ["--import", resolve("test/demo-fetch.mjs"), resolve("dist/plugin.mjs")]);
    let out = "";
    c.stdout.on("data", (d) => { out += d; const i = out.indexOf("\n"); if (i >= 0) { c.kill(); res({ ms: Date.now() - t, response: JSON.parse(out.slice(0, i)) }); } });
    c.on("close", () => rej(new Error("no answer")));
    c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: meta } }) + "\n");
  });
}
const runs = [
  ["btc", "styx_scan_wallet", { address: "bc1qstyxdemqwaterfqwxyz2345678qpzry9x8gf2tvdw0s3j" }],
  ["sol", "styx_scan_wallet", { address: "StyxDemoRiverWhaxe8888888888888888888888", chain: "solana" }],
  ["near", "styx_scan_wallet", { address: "styx-demo.near" }],
  ["bnb", "styx_scan_wallet", { address: "0xdead00000000000000000000000000000000beef" }],
  ["bad", "styx_scan_wallet", { address: "hello-ferryman!!" }],
  ["currents", "styx_currents", { limit: 8 }],
  ["legend", "styx_legend", {}],
];
const outp = {};
for (const [k, tool, args] of runs) outp[k] = { tool, args, ...(await call(tool, args)) };
const list = await new Promise((res) => {
  const c = spawn(process.execPath, [resolve("dist/plugin.mjs")]); let o = "";
  c.stdout.on("data", (d) => { o += d; const i = o.indexOf("\n"); if (i >= 0) { c.kill(); res(JSON.parse(o.slice(0, i))); } });
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }) + "\n");
});
outp.tools = list.result.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema }));
writeFileSync(process.argv[2], JSON.stringify(outp));
console.log(Object.entries(outp).filter(([k]) => k !== "tools").map(([k, v]) => `${k}: ${v.ms}ms ${v.response.result?.isError ? "isError" : v.response.result?.structuredContent?.risk?.verdict ?? "ok"}`).join("\n"));
