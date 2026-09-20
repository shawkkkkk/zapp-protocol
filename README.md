# ZApp Protocol

**Launch on Solana. Burn. Receive a Zcash NFT.**

ZApp is a permissionless asset-launchpad workaround for the fact that native custom assets are not active on Zcash mainnet yet. Users launch or select an SPL/Token-2022 asset, burn tokens on Solana, and receive a **real collectible inscription/NFT on Zcash mainnet** representing that destruction. A compact Proof layer sits underneath the NFT for verification, duplicate protection and ownership reconstruction.

It does **not** pretend that Zcash Shielded Assets are already live. ZIP-226/227 remain
draft consensus proposals. A ZApp Proof is a Zcash-mainnet inscription/receipt under ZApp's
rules, not a native ZSA.

## What is real now

| Event | Chain | Status |
|---|---|---|
| SPL / Token-2022 `BurnChecked` | Solana mainnet | Real |
| Destination commitment | Same Solana tx memo | Real |
| ZApp NFT / inscription | Zcash mainnet | Real |
| 78-byte ZApp Proof verification layer | Zcash transparent `OP_RETURN` | Real |
| Marker ownership output | Zcash mainnet | Real |
| Native shielded custom asset | Zcash | **Not live** |
| Future ZSA conversion | Future policy | **Not guaranteed by current consensus** |

No `mock-...` transaction IDs exist anywhere in ZApp.

## Product premise

The NFT is the user-facing object. It records the Solana mint, burn signature, burn ID, exact amount and Zcash destination. It can be independently checked against the source burn. If compatible native Zcash assets ship later, canonical NFT ownership is the intended migration basis under a separately versioned policy.

See [docs/NFT_MODEL.md](docs/NFT_MODEL.md).

## Why this is stronger than a trusted certificate server

ZApp validity does not depend on the website, relay wallet, database, or a developer key.

For each Zcash Proof, an independent indexer can:

1. decode the Solana mint + burn commitment + exact uint64 amount;
2. enumerate finalized Solana transactions involving that mint;
3. find the one whose deterministic burn ID matches;
4. verify the transaction actually succeeded and destroyed that exact amount;
5. recover the Zcash destination committed in the same Solana transaction;
6. verify the Zcash transaction pays the marker output to that address; and
7. reject every later duplicate claim for the same burn.

If somebody writes a fake 10× amount into Zcash, Zcash consensus may accept the arbitrary
data, but **ZApp rejects it**.

## v1 payload

Exactly 78 bytes:

```text
0..3    "ZAPP"
4       version = 1
5       operation = 1 (claim)
6..37   Solana mint (32 raw bytes)
38..69  burn ID (SHA-256)
70..77  amount (uint64 LE, SPL base units)
```

The data fits inside the 80-byte standard data-carrier budget.

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for canonical rules and
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for attack handling.

## Repository layout

```text
src/
  app/                  Next.js launchpad, explorer and API
  components/           wallet / burn / token-creation UI
  lib/
    protocol.ts         chain-independent binary codec
    validation.ts       pure validity rules
    client/solana.ts    wallet transaction builders
    server/solana.ts    finalized burn verifier / discovery
    server/zcash.ts     Zcash transaction + RPC adapter
    server/db.ts        durable relay/index state
scripts/
  index-zcash.ts        independent mainnet indexer + reorg replay
db/
  001_init.sql
docs/
  PROTOCOL.md
  THREAT_MODEL.md
  MIGRATION_POLICY.md
  OPERATIONS.md
tests/
```

## Local setup

```bash
cp .env.example .env
docker compose up -d
psql "$DATABASE_URL" -f db/001_init.sql
npm install
npm test
npm run typecheck
npm run dev
```

For a production Zcash relay, configure a synced mainnet node with wallet functionality.
The current adapter uses legacy raw-transaction wallet RPCs; those are deliberately isolated
behind one module so they can be replaced by Zallet/PCZT without changing protocol rules.

Run the indexer separately:

```bash
npm run index:zcash -- --watch
```

Set `ZAPP_ZCASH_START_HEIGHT` to the block immediately before the first production Proof.

## Launchpad flow

### Existing token

1. Connect a Solana wallet.
2. Enter any standard SPL or Token-2022 mint.
3. Enter amount + Zcash mainnet t-address.
4. Wallet signs one transaction containing `BurnChecked + ZAPP1:<address>`.
5. ZApp waits for Solana finality.
6. The server independently reparses the finalized transaction.
7. A real Zcash mainnet transaction is constructed, decoded, checked, signed and broadcast.
8. The chain indexer independently reconstructs it and marks it canonical.
9. Ownership follows the marker UTXO; later ZAPP transfer transactions can move the Proof
   while preserving a fully reconstructible ownership lineage.

### New token

The included simple creator produces a classic SPL mint, mints the fixed supply to the
creator, and **revokes mint authority in the same transaction**. Token branding/metadata is
intentionally not part of supply validity.

## Integer correctness

SPL quantities never pass through JavaScript `number`. They use:

- `bigint` in TypeScript;
- uint64 in the binary protocol; and
- `NUMERIC(20,0)` in Postgres.

The test suite includes amounts above `Number.MAX_SAFE_INTEGER`.

## Production rules

Before a public launch, complete every item in
[docs/OPERATIONS.md](docs/OPERATIONS.md), including a real end-to-end mainnet smoke test and
an independent indexer rebuild.

A sponsored relay can optionally require a SOL service fee in the same burn transaction.
The protocol itself remains permissionless: another party may construct and pay for a valid
Zcash Proof as long as the destination and burn data are correct.

## Future ZSAs

ZApp v1 deliberately does not hard-code a fictional ZSA transaction format. If/when a
compatible custom-asset protocol activates, migration will be introduced as a new auditable
version against the rules that actually shipped.

See [docs/MIGRATION_POLICY.md](docs/MIGRATION_POLICY.md).

## License

MIT

## Operator independence

The official website is not required for protocol recovery.

```bash
# Independently relay a finalized burn with your own funded Zcash wallet
npm run relay:proof -- <solana-signature>

# Transfer a confirmed Proof from the wallet controlling its current marker
npm run transfer:proof -- <burn-id> <new-zcash-t-address>

# Publish the canonical state commitment for independent comparison
npm run state:root
```

The state endpoint (`/api/state`) reports the indexed Zcash height/block hash, Proof count,
per-mint base-unit totals, and a deterministic state root committing to current ownership.
