import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { bnbCurrents, btcCurrents, nearCurrents, scanWallet, solCurrents, type Current } from "./chains.js";
import { CHAIN_INFO, CHAINS, detectChain, HOSTS, KNOWN_WALLETS, knownLabel, normalize, type Chain } from "./registry.js";
import { goplusFlags, listFlags, loadLists } from "./risk.js";
import { fmt, health, HEALTH_TIERS, renderFlow, reservoir, short, type Association } from "./styx.js";

const PROTOCOL_VERSION = "2026-07-28";
const VERSION = "0.1.0";

const chainEnum = z.enum(["bitcoin", "solana", "near", "bnb"]);

const flowSchema = z.object({
  txid: z.string(),
  time: z.string().nullable(),
  direction: z.enum(["in", "out", "self"]),
  amount: z.number(),
  tier: z.enum(["trickle", "rivulet", "stream", "main stream"]),
  splits: z.array(z.object({ address: z.string(), amount: z.number() })),
});

const scanOutput = z.object({
  chain: chainEnum,
  address: z.string(),
  label: z.string().nullable(),
  explorer: z.string(),
  symbol: z.string(),
  health: z.object({
    txCount: z.number(),
    exact: z.boolean(),
    status: z.enum(["dry", "poor", "healthy", "underdog", "overscaled"]),
    nickname: z.string(),
    flow: z.string(),
  }),
  reservoir: z.object({
    balance: z.number(),
    form: z.enum(["dry bed", "puddle", "pond", "lake", "great lake", "abyss"]),
    name: z.string(),
  }),
  flows: z.array(flowSchema),
  associations: z.array(
    z.object({
      address: z.string(),
      label: z.string().nullable(),
      inflow: z.number(),
      outflow: z.number(),
      txs: z.number(),
      flags: z.array(z.string()),
    }),
  ),
  risk: z.object({
    verdict: z.enum(["clean", "tainted", "damned"]),
    walletFlags: z.array(z.string()),
    taintedAssociates: z.number(),
    sources: z.array(z.string()),
    unavailable: z.array(z.string()),
  }),
  notes: z.array(z.string()),
  checkedAt: z.string(),
});

const currentSchema = z.object({
  chain: chainEnum,
  txid: z.string(),
  time: z.string().nullable(),
  amount: z.number(),
  tier: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  splits: z.number(),
});

const currentsOutput = z.object({
  currents: z.array(currentSchema),
  perChain: z.array(z.object({ chain: chainEnum, sampled: z.number(), ok: z.boolean(), note: z.string().nullable() })),
  checkedAt: z.string(),
});

const legendOutput = z.object({
  healthTiers: z.array(z.object({ minTx: z.number(), maxTx: z.number().nullable(), status: z.string(), nickname: z.string(), flow: z.string() })),
  flowThresholds: z.array(z.object({ chain: chainEnum, symbol: z.string(), rivulet: z.number(), stream: z.number(), mainStream: z.number() })),
  waterBodies: z.array(z.object({ form: z.string(), name: z.string(), rule: z.string() })),
  knownWallets: z.array(z.object({ chain: chainEnum, address: z.string(), label: z.string(), source: z.string() })),
  networkHosts: z.array(z.string()),
});

/** Deposits below these native amounts count as dust. */
const DUST: Record<Chain, number> = { bitcoin: 0.00001, solana: 0.001, near: 0.01, bnb: 0.0001 };

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const errorResult = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

function createServer() {
  const server = new McpServer({ name: "styx-watch", version: VERSION }, { supportedProtocolVersions: [PROTOCOL_VERSION] });

  server.registerTool(
    "styx_scan_wallet",
    {
      title: "Scan a wallet on the River Styx",
      description:
        "Scans a Bitcoin, Solana, NEAR or BNB Chain wallet: balance as a lake or pond, recent fund movements as streams and tributaries, " +
        "activity health by transaction count, and every counterparty screened against OFAC sanctions, the ScamSniffer blacklist and GoPlus risk flags. " +
        "Read-only; never needs a private key. Chain is detected from the address if omitted.",
      inputSchema: z
        .object({
          address: z.string().min(2).max(100).describe("Wallet address or NEAR account ID"),
          chain: chainEnum.optional().describe("bitcoin, solana, near or bnb; detected from the address when omitted"),
        })
        .strict(),
      outputSchema: scanOutput,
      annotations: readOnly,
    },
    async ({ address, chain }) => {
      const addr = address.trim();
      const c = chain ?? detectChain(addr);
      if (!c) return errorResult("Could not tell which network this address belongs to. Pass chain: bitcoin, solana, near or bnb.");
      if (c === "near" && !detectChain(addr.toLowerCase())) return errorResult("That is not a valid NEAR account ID.");
      const key = normalize(c, addr);

      // Start the scam-list lookups alongside the chain scan so the whole call stays inside the 10 s budget.
      const listsP = loadLists(c);
      const gpP = goplusFlags(c, addr);
      let data;
      try {
        data = await scanWallet(c, addr);
      } catch (e) {
        return errorResult(`The ${c} data source did not answer in time (${(e as Error).message}). Try again in a moment.`);
      }
      const [lists, gp] = await Promise.all([listsP, gpP]);

      // Mental map: every counterparty seen in the recent flows.
      const assoc = new Map<string, Association>();
      for (const f of data.flows) {
        for (const s of f.splits) {
          const k = normalize(c, s.address);
          if (k === key) continue;
          const a = assoc.get(k) ?? { address: s.address, label: knownLabel(c, s.address) ?? null, inflow: 0, outflow: 0, txs: 0, flags: listFlags(lists, c, s.address) };
          if (f.direction === "in") a.inflow += s.amount;
          else a.outflow += s.amount;
          a.txs += 1;
          assoc.set(k, a);
        }
      }
      const associations = [...assoc.values()].sort((x, y) => y.flags.length - x.flags.length || y.inflow + y.outflow - (x.inflow + x.outflow)).slice(0, 40);
      const walletFlags = [...listFlags(lists, c, addr), ...gp.flags];
      const tainted = associations.filter((a) => a.flags.length > 0).length;
      const verdict = walletFlags.length > 0 ? "damned" : tainted > 0 ? "tainted" : "clean";
      const sources = [...lists.sources, ...(gp.checked ? ["GoPlus"] : [])];
      const unavailable = [...lists.unavailable];
      if (c === "near") unavailable.push("No public scam list covers NEAR");

      const h = health(data.txCount, data.txCountExact);
      const r = reservoir(c, data.balance);
      const sym = CHAIN_INFO[c].symbol;
      const label = knownLabel(c, addr) ?? null;
      // Dust: tiny unsolicited deposits, usually address-poisoning spam. Keep them screened, but group them.
      const dust = data.flows.filter((f) => f.direction === "in" && f.amount < DUST[c]);
      const flows = data.flows.filter((f) => !dust.includes(f)).slice(0, 15);
      const notes = [...data.notes];
      if (dust.length) {
        const total = dust.reduce((x, f) => x + f.amount, 0);
        notes.unshift(
          `${dust.length} dust drop${dust.length > 1 ? "s" : ""} (tiny deposits totalling ${fmt(total)} ${CHAIN_INFO[c].symbol}) hidden from the river. ` +
            "Dust is a common address-poisoning trick: never copy an address from this wallet's history.",
        );
      }

      const lines = [
        `☠ STYX WATCH — ${c.toUpperCase()} · ${short(addr)}${label ? `  [${label}]` : ""}`,
        `Current:   ${h.flow}  ${h.nickname.toUpperCase()} (${h.exact ? "" : "≥"}${fmt(h.txCount)} txs · ${h.status})`,
        `Reservoir: ${r.name} — ${fmt(r.balance)} ${sym} held`,
        "",
        flows.length ? "Recent waters:" : dust.length ? "Recent waters: only dust drops (see note)" : "Recent waters: none visible from keyless sources",
        ...flows.flatMap((f) => renderFlow(c, f)),
        "",
        verdict === "clean"
          ? `Judgement: CLEAN — no sanctioned or blacklisted wallets among ${associations.length} associates (${sources.join(", ") || (c === "near" ? "no public scam list covers NEAR yet" : "no lists reachable")}).`
          : verdict === "tainted"
            ? `Judgement: TAINTED — ${tainted} associate(s) flagged: ${associations.filter((a) => a.flags.length).slice(0, 5).map((a) => `${short(a.address)} (${a.flags.join(", ")})`).join("; ")}`
            : `Judgement: DAMNED — this wallet is flagged: ${walletFlags.join(", ")}`,
        ...notes.map((n) => `Note: ${n}`),
        `Explorer: ${CHAIN_INFO[c].explorer(addr)}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          chain: c,
          address: addr,
          label,
          explorer: CHAIN_INFO[c].explorer(addr),
          symbol: sym,
          health: h,
          reservoir: r,
          flows,
          associations,
          risk: { verdict, walletFlags, taintedAssociates: tainted, sources, unavailable },
          notes,
          checkedAt: new Date().toISOString(),
        },
      };
    },
  );

  server.registerTool(
    "styx_currents",
    {
      title: "Watch the great currents",
      description:
        "Returns the largest recent fund movements across Bitcoin, Solana, NEAR and BNB Chain, ranked as main streams, streams and rivulets. " +
        "Call it repeatedly (for example every minute) to keep a live feed of whale and market-maker movement.",
      inputSchema: z
        .object({
          chains: z.array(chainEnum).min(1).max(4).optional().describe("Networks to sample; all four when omitted"),
          limit: z.number().int().min(1).max(30).optional().describe("Movements to return, largest first (default 12)"),
        })
        .strict(),
      outputSchema: currentsOutput,
      annotations: { ...readOnly, idempotentHint: false },
    },
    async ({ chains, limit }) => {
      const want = chains ?? [...CHAINS];
      const solWatch = KNOWN_WALLETS.filter((w) => w.chain === "solana").map((w) => w.address);
      const runners: Record<Chain, () => Promise<Current[]>> = {
        bitcoin: btcCurrents,
        bnb: bnbCurrents,
        solana: () => solCurrents(solWatch),
        near: nearCurrents,
      };
      const results = await Promise.all(
        want.map(async (c) => {
          try {
            const list = await runners[c]();
            return { c, list, ok: true, note: c === "solana" ? "Sampled from labelled exchange wallets" : null };
          } catch (e) {
            return { c, list: [] as Current[], ok: false, note: (e as Error).message.slice(0, 160) };
          }
        }),
      );
      const scale = (x: Current) => x.amount / CHAIN_INFO[x.chain].flow[1];
      const currents = results
        .flatMap((r) => r.list)
        .filter((x) => x.amount > 0)
        .sort((a, b) => scale(b) - scale(a))
        .slice(0, limit ?? 12);
      const lines = [
        "☠ THE GREAT CURRENTS OF THE STYX",
        ...currents.map((x) => {
          const who = x.from || x.to ? ` ${x.from ? short(x.from) : "?"} ⇢ ${x.to ? short(x.to) : "?"}` : "";
          const lab = (x.from && knownLabel(x.chain, x.from)) || (x.to && knownLabel(x.chain, x.to));
          return `${x.tier === "main stream" ? "━━━━━━━" : x.tier === "stream" ? "━━━━" : "──"} ${x.chain.toUpperCase().padEnd(7)} ${fmt(x.amount)} ${CHAIN_INFO[x.chain].symbol}${who}${lab ? ` [${lab}]` : ""}${x.splits > 1 ? ` · ${x.splits} waterways` : ""}`;
        }),
        ...results.filter((r) => !r.ok).map((r) => `⚠ ${r.c}: source unavailable (${r.note})`),
      ];
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          currents,
          perChain: results.map((r) => ({ chain: r.c, sampled: r.list.length, ok: r.ok, note: r.note })),
          checkedAt: new Date().toISOString(),
        },
      };
    },
  );

  server.registerTool(
    "styx_legend",
    {
      title: "Styx map legend",
      description: "Explains the Styx map: health nicknames by transaction count, stream thresholds per network, lakes and ponds, and labelled market-maker wallets.",
      inputSchema: z.object({}).strict(),
      outputSchema: legendOutput,
      annotations: { ...readOnly, openWorldHint: false },
    },
    async () => {
      const healthTiers = HEALTH_TIERS.map((t) => ({
        minTx: t.min,
        maxTx: t.max === Number.MAX_SAFE_INTEGER ? null : t.max,
        status: t.status,
        nickname: t.nickname,
        flow: t.flow,
      }));
      const flowThresholds = CHAINS.map((c) => {
        const [rivulet, stream, mainStream] = CHAIN_INFO[c].flow;
        return { chain: c, symbol: CHAIN_INFO[c].symbol, rivulet, stream, mainStream };
      });
      const waterBodies = [
        { form: "dry bed", name: "Dry riverbed", rule: "zero balance" },
        { form: "puddle", name: "Puddle of Lethe", rule: "below rivulet threshold" },
        { form: "pond", name: "Pond of Shades", rule: "rivulet to stream threshold" },
        { form: "lake", name: "Lake Avernus", rule: "stream to main-stream threshold" },
        { form: "great lake", name: "Great Marsh of Acheron", rule: "main stream up to 10×" },
        { form: "abyss", name: "Abyss of Tartarus", rule: "over 10× main-stream threshold" },
      ];
      const text = [
        "☠ STYX LEGEND",
        ...healthTiers.map((t) => `${t.flow.padEnd(16)} ${t.nickname} — ${fmt(t.minTx)}${t.maxTx === null ? "+" : `–${fmt(t.maxTx)}`} txs (${t.status})`),
        "",
        ...flowThresholds.map((f) => `${f.chain.padEnd(8)} rivulet ≥${fmt(f.rivulet)} · stream ≥${fmt(f.stream)} · main stream ≥${fmt(f.mainStream)} ${f.symbol}`),
        "",
        ...waterBodies.map((w) => `${w.name}: ${w.rule}`),
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { healthTiers, flowThresholds, waterBodies, knownWallets: KNOWN_WALLETS, networkHosts: Object.values(HOSTS) },
      };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
