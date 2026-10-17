# ☠ Styx Watch

**Check a crypto wallet before you send it money.**

Styx Watch is a [PayBox](https://developer.paybox.sh) plugin built for the MoonPay × PayBox hackathon (October 2026). Paste any **Bitcoin, Solana, NEAR or BNB Chain** wallet and your agent maps where its money flows as a river from Greek myth:

- **Main streams, streams and rivulets** are its transfers, sized by amount.
- **Tributaries** show where a payment split across several wallets.
- **Lakes and ponds** show what it holds, from a *Dry riverbed* to the *Abyss of Tartarus*.
- **A judgement** of *Clean*, *Tainted* or *Damned*. Every wallet it dealt with is checked against the OFAC sanctions lists, the ScamSniffer blacklist and GoPlus risk flags.

The plugin is read-only. It never asks for a private key and never proposes a transaction.

## Live result

Running `styx_scan_wallet` on Binance's Bitcoin cold wallet from the PayBox developer portal (17 Oct 2026):

```
☠ STYX WATCH — BITCOIN · 34xp4v…wseo  [Binance cold wallet]
Current:   ≋≋≋≋≋≋≋≋  THE UNDERDOG (5,590 txs · underdog)
Reservoir: Abyss of Tartarus — 248,597.5928 BTC held
Judgement: CLEAN — no sanctioned or blacklisted wallets among 30 associates (OFAC XBT).
```

The call finished in about 4 seconds, inside PayBox's 10-second limit.

## Tools

| Tool | What it does |
|---|---|
| `styx_scan_wallet` | Scans one wallet: balance as a water body, recent flows as streams and tributaries, activity health, scam and sanctions screening of every counterparty. Detects the network from the address. |
| `styx_currents` | The largest recent movements across all four networks, ranked. Call it on a timer for a live whale feed. |
| `styx_legend` | Explains the map: health nicknames, stream thresholds per network, water bodies and labelled market-maker wallets. |

### Activity health

| Transactions | Nickname |
|---|---|
| 0 | Lethe's Dry Bed |
| 1–99 (poor) | Shade's Trickle |
| 100–999 (healthy) | Ferryman's Current |
| 1,000–9,999 | The Underdog |
| 10,000–99,999 | Cerberus Torrent |
| 100,000–999,999 | Acheron Flood |
| 1,000,000+ | Leviathan of Hades |

Dust (tiny unsolicited deposits, a common address-poisoning trick) is grouped into one warning instead of cluttering the river.

## Data sources

All sources are free and keyless.

| Network | Source | Coverage |
|---|---|---|
| Bitcoin | [mempool.space](https://mempool.space) (open source) | Balance, full count, last 25 transactions |
| Solana | Solana public RPC | Balance, count up to 1,000, last 8 transactions |
| NEAR | FastNEAR / NEAR RPC, NearBlocks | Balance, count, last 25 transactions |
| BNB Chain | BNB Chain public RPC | Balance, sent count, latest-block whales. Address history needs a paid key |
| Risk | [OFAC lists by 0xB10C](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses), [ScamSniffer](https://github.com/scamsniffer/scam-database), [GoPlus](https://gopluslabs.io) | No public scam list covers NEAR yet |

A *Clean* judgement means none of these sources flag the wallet. It is not a guarantee of safety. Exchange labels come from public explorer name tags and do not prove ownership.

### Network hosts to allow in the PayBox portal

```
mempool.space
api.mainnet-beta.solana.com
free.rpc.fastnear.com
rpc.mainnet.near.org
api.nearblocks.io
bsc-dataseed.bnbchain.org
api.gopluslabs.io
raw.githubusercontent.com
```

No variables or secrets are needed.

## Build and test

Requires Node.js 24 and pnpm 11.11.0 (macOS, Linux or WSL2).

```bash
pnpm install --frozen-lockfile
pnpm test           # type-check, two identical builds, MCP conformance
node test/run.mjs   # 8 behaviour tests against the bundle with mocked chain APIs
```

The upload artifact is `dist/plugin.mjs`.

## Web pages

- `web/river-map.html` is the animated River Styx map. Open it in a browser for live scans and a whale feed that refreshes every minute.
- `web/project-page.html` is the project page, with a test console that replays recorded runs of the plugin on example wallets.

## Layout

```
src/plugin.ts     MCP server and the three tools
src/chains.ts     Bitcoin, Solana, NEAR and BNB readers, bounded to fit 10 s
src/risk.ts       OFAC, ScamSniffer and GoPlus screening
src/styx.ts       Stream tiers, water bodies, health nicknames, text river map
src/registry.ts   Chain settings, labelled wallets, hosts, address detection
scripts/          PayBox plugin starter 1.0.2 tooling (conformance and schema checks rebuilt from its spec)
test/             Behaviour tests and example fixtures
```

## Author

Made by Greggs for the MoonPay × PayBox hackathon.
