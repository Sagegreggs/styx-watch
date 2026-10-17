// Reconstructed from the PayBox starter 1.0.2 description (verbatim copy was unavailable).
// Runs the bundled plugin in fresh child processes and speaks MCP 2026-07-28 over stdio.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { withProcess } from "./process.mjs";
import { ConformanceError, release, reportConformance } from "./report.mjs";
import { compileSchema, validateSample } from "./schema.mjs";

export { ConformanceError, reportConformance };

const MAX_BUNDLE = 10 * 1024 * 1024;
const MAX_STDOUT = 256 * 1024;
const MAX_STDERR = 16 * 1024;
const MAX_PAGES = 16;
const MAX_TOOLS = 256;
const MAX_SCHEMA = 64 * 1024;

const envelope = () => ({
  "io.modelcontextprotocol/protocolVersion": release.protocolVersion,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "paybox-conformance", version: release.version },
});

async function request(artifact, method, params) {
  const home = await mkdtemp(join(tmpdir(), "paybox-home-"));
  try {
    return await withProcess(process.execPath, [artifact], { env: { HOME: home, PATH: process.env.PATH ?? "" } }, async (child, closed) => {
      let out = "";
      let errBytes = 0;
      child.stderr.on("data", (d) => { errBytes += d.length; });
      const done = new Promise((res, rej) => {
        child.stdout.on("data", (d) => {
          out += d.toString("utf8");
          if (Buffer.byteLength(out) > MAX_STDOUT) rej(new ConformanceError("stdout exceeded 256 KiB", "limit_exceeded"));
          const nl = out.indexOf("\n");
          if (nl >= 0) res(out.slice(0, nl));
        });
        closed.then(() => rej(new ConformanceError("Plugin exited before answering", "startup_failed")));
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: envelope() } })}\n`);
      const line = await done;
      if (errBytes > MAX_STDERR) throw new ConformanceError("stderr exceeded 16 KiB", "limit_exceeded");
      let msg;
      try { msg = JSON.parse(line); } catch { throw new ConformanceError("stdout line is not JSON", "protocol_invalid"); }
      if (msg.id !== 1 || msg.jsonrpc !== "2.0") throw new ConformanceError("Response ID does not match", "protocol_invalid");
      if (msg.error) throw new ConformanceError(`${method} returned a JSON-RPC error`, method === "tools/call" ? "tool_failed" : "protocol_invalid");
      if (msg.result?.resultType !== undefined && msg.result.resultType !== "complete") {
        throw new ConformanceError("resultType must be complete", "protocol_invalid");
      }
      return msg.result;
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export async function testArtifact(root) {
  const artifact = resolve(root, "dist/plugin.mjs");
  let bytes;
  try { bytes = await readFile(artifact); } catch { throw new ConformanceError("dist/plugin.mjs is missing", "artifact_invalid"); }
  if (bytes.length === 0 || bytes.length > MAX_BUNDLE) throw new ConformanceError("Bundle must be 1 byte to 10 MiB", "artifact_invalid");
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new ConformanceError("Bundle is not UTF-8", "artifact_invalid"); }

  let config;
  try { config = JSON.parse(await readFile(resolve(root, "paybox-plugin.json"), "utf8")); }
  catch { throw new ConformanceError("paybox-plugin.json is not valid JSON", "config_invalid"); }
  if (typeof config.tool !== "string" || typeof config.arguments !== "object" || config.arguments === null) {
    throw new ConformanceError("paybox-plugin.json needs tool and arguments", "config_invalid");
  }
  if (Buffer.byteLength(JSON.stringify(config.arguments)) > 64 * 1024) throw new ConformanceError("Sample arguments exceed 64 KiB", "limit_exceeded");

  const tools = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await request(pathToFileURL(artifact).pathname, "tools/list", cursor ? { cursor } : {});
    if (!Array.isArray(result?.tools)) throw new ConformanceError("tools/list did not return tools", "tool_catalog_invalid");
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
    if (Buffer.byteLength(cursor) > 1024) throw new ConformanceError("Cursor exceeds 1 KiB", "limit_exceeded");
  }
  if (tools.length > MAX_TOOLS) throw new ConformanceError("More than 256 tools", "limit_exceeded");
  const names = new Set();
  for (const t of tools) {
    if (typeof t.name !== "string" || !t.name || Buffer.byteLength(t.name) > 128 || names.has(t.name)) {
      throw new ConformanceError("Tool names must be unique, non-empty and at most 128 bytes", "tool_catalog_invalid");
    }
    names.add(t.name);
    for (const k of ["title", "description"]) if (t[k] !== undefined && typeof t[k] !== "string") throw new ConformanceError(`Tool ${k} must be a string`, "tool_catalog_invalid");
    if (t.annotations !== undefined && (typeof t.annotations !== "object" || t.annotations === null)) throw new ConformanceError("annotations must be an object", "tool_catalog_invalid");
    const schemaText = JSON.stringify([t.inputSchema, t.outputSchema ?? null]);
    if (schemaText.includes("x-mcp-header")) throw new ConformanceError("x-mcp-header is unsupported", "tool_catalog_invalid");
    if (Buffer.byteLength(schemaText) > MAX_SCHEMA) throw new ConformanceError(`Schemas for ${t.name} exceed 64 KiB`, "limit_exceeded");
    compileSchema(t.inputSchema);
    if (t.outputSchema) compileSchema(t.outputSchema);
  }

  const tool = tools.find((t) => t.name === config.tool);
  if (!tool) throw new ConformanceError(`Sample tool ${config.tool} was not discovered`, "config_invalid");
  validateSample(tool, config.arguments);
  const result = await request(pathToFileURL(artifact).pathname, "tools/call", { name: config.tool, arguments: config.arguments });
  if (result?.isError) throw new ConformanceError("Sample call returned isError", "tool_failed");
  if (Array.isArray(result?.content) && result.content.length > 128) throw new ConformanceError("More than 128 content blocks", "limit_exceeded");
  validateSample(tool, config.arguments, result);

  return {
    status: "passed",
    sampleCall: { tool: config.tool, status: "passed" },
    artifact: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
    discoveredToolCount: tools.length,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await reportConformance(() => testArtifact(process.cwd()));
}
