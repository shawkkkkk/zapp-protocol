# ZApp public launch runbook

ZApp defaults to preview mode. Irreversible actions stay disabled until production
infrastructure is healthy and the public launch gate is deliberately opened.

## 1. Provision production dependencies

Required:

- PostgreSQL with every `db/*.sql` migration applied.
- Dedicated transaction-history/archive-capable Solana mainnet RPC.
- Permanent HTTPS custom domain configured as both `NEXT_PUBLIC_APP_URL` and `ZAPP_CANONICAL_ORIGIN`.
- Synced Zcash mainnet wallet/node RPC.
- A wallet-owned compressed transparent signer address in `ZAPP_NFT_SIGNER_TADDR`.
- Enough transparent ZEC for commit/reveal postage and network fees.
- NFT worker running the compiled Rust signer.

Do not expose the Zcash RPC directly to the public internet.

## 2. Start in preview mode

Set:

```
ZAPP_PUBLIC_LAUNCH_ENABLED=false
NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED=false
```

Start the stack:

```bash
docker compose up -d --build
```

The web UI should load but every irreversible launch/burn action should be visibly locked.

## 3. Production preflight

Run from the production environment:

```bash
npm run preflight
```

It must report PASS for:

- required database migrations;
- Solana mainnet genesis hash;
- Zcash mainnet node and sync state;
- wallet-owned inscription signer;
- minimum relay ZEC balance;
- fresh NFT-worker heartbeat;
- fresh automatic Solana burn-watcher heartbeat;
- fresh independent Zcash-indexer heartbeat;
- immutable image/rate-limit/attestation/indexer-verification schema;
- permanent custom metadata origin; and
- NFT queue access.

The Solana mainnet full genesis hash is pinned to
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`.

Also verify:

```bash
curl -i https://<production-host>/api/readiness
```

Before the gate is opened it should return HTTP 503 even when infrastructure checks pass,
because `ZAPP_PUBLIC_LAUNCH_ENABLED` is still false.

## 4. Mainnet canary

Keep both public launch gates false. Temporarily set:

```
ZAPP_CANARY_ENABLED=true
ZAPP_CANARY_SECRET=<long random secret>
ZAPP_SOLANA_WATCHER_ENABLED=true
ZAPP_INDEXER_ENABLED=true
```

Open the unlisted `/canary` page, unlock it with the canary secret, and use the same
production wallet/launch/burn UI that public users will use. The secret is exchanged for
an HttpOnly two-hour session; it is not a client-side feature flag.

Before public announcement, use the smallest practical canary supply and burn amount.

Verify in order:

1. Solana burn reaches finalized.
2. Confirm the automatic Solana watcher discovers and queues the burn without relying on the browser.
3. `/api/claims` recovery remains idempotent for the same burn.
4. NFT job enters `queued` / `building`.
5. Commit transaction is broadcast and confirmed.
6. Reveal transaction is broadcast and confirmed.
7. The reveal contains the ZApp NFT content and compact Proof carrier.
8. The destination owns output 0 / current marker.
9. Explorer shows the same burn amount, mint, destination and inscription id.
10. Stop/restart the backend worker and verify no duplicate inscription is produced.
11. Run the independent indexer/state-root reconstruction.
12. Run `npm run canary:audit -- <burnId>` and require every line to PASS.

The canary audit requires the worker-confirmed reveal transaction to equal the canonical
indexed claim and requires `indexer_verified_at` to be present. Do not enable public burns
if any canary step fails.

## 5. Open the gate

First disable private canary access:

```
ZAPP_CANARY_ENABLED=false
```

Then set both public values to true and rebuild/restart the web process:

```
ZAPP_PUBLIC_LAUNCH_ENABLED=true
NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED=true
```

Then run:

```bash
npm run preflight:public
```

`/api/readiness` should now return HTTP 200. Before the gate is opened, ordinary
`npm run preflight` validates infrastructure while intentionally allowing the gate to
remain closed.

## 6. First-hour monitoring

Watch:

- `/api/status` queue counts;
- `/api/readiness`;
- worker logs;
- Zcash wallet balance;
- failed NFT jobs;
- duplicate/recovery requests; and
- independent state-root agreement.

Keep the initial relay wallet intentionally small.

## Emergency stop

Set:

```
ZAPP_PUBLIC_LAUNCH_ENABLED=false
NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED=false
```

Restart/redeploy the web process.

This blocks new asset registrations and new burn claims at both UI and API layers. Existing
confirmed burns and already-broadcast Zcash transactions remain chain history. The NFT
worker can be left running to finish already-accepted jobs, or stopped separately if the
incident involves the Zcash writer/signer.

Never delete or rewrite canonical burn/NFT rows to hide an incident. Preserve evidence and
rebuild state from the two chains after remediation.
