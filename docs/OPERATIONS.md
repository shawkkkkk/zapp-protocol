# Production operations

## Required infrastructure

- Node.js 22+
- PostgreSQL 17+
- an archive-capable Solana mainnet RPC with transaction-history access
- a synced Zcash mainnet node with wallet functionality and enough transparent ZEC to fund
  marker outputs and fees
- `-txindex=1` is strongly recommended for diagnostics and independent verification

The current relay adapter uses the legacy `createrawtransaction`, `fundrawtransaction`
and `signrawtransaction` RPC path. Current zcashd marks funding/signing RPCs deprecated in
favor of future Zallet/PCZT flows, so isolate this adapter and replace it when the production
wallet stack is ready.

## Database

Apply:

```bash
psql "$DATABASE_URL" -f db/001_init.sql
```

## Indexer start height

Set `ZAPP_ZCASH_START_HEIGHT` to the block immediately before the first production ZApp
claim. Do not leave it at zero in production unless you intentionally want a full-chain
scan.

## Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm run start
npm run index:zcash -- --watch
```

Run the web application and indexer as separate processes.

## Fail-closed checks

A production launch should not be announced until all of these work end to end:

- SPL Token burn
- Token-2022 burn
- finalized source verification
- bad memo rejection
- wrong amount rejection
- duplicate burn rejection
- Zcash address validation
- Zcash transaction construction
- Zcash broadcast
- block inclusion
- indexer reconstruction from chain data
- reorg replay
- clean rebuild into an empty database

Maintain at least one independent read-only indexer whose database is not shared with the
relay service and compare canonical proof counts/state regularly.
