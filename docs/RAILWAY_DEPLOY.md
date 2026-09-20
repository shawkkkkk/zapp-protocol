# Railway deployment

Railway is a practical fit for ZApp because the project needs a public Next.js service,
a long-running NFT worker, and PostgreSQL. Railway maps those to separate services rather
than running docker-compose directly.

## Services

Create one Railway project with:

1. **Postgres** — Railway managed PostgreSQL.
2. **zapp-web** — source: `shawkkkkk/zapp-protocol`, Dockerfile:
   `Dockerfile.web`.
3. **zapp-nft-worker** — same repository, Dockerfile:
   `Dockerfile.worker`.

The Zcash wallet/node should be treated as security-sensitive infrastructure. It may run in
a separate hardened environment; expose its RPC only over a private network or authenticated
tunnel to the web/worker services.

## Web service

Set:

```
RAILWAY_DOCKERFILE_PATH=Dockerfile.web
DATABASE_URL=<reference to Postgres DATABASE_URL>
SOLANA_RPC_URL=<production archive Solana RPC>
NEXT_PUBLIC_SOLANA_RPC_URL=<public-safe Solana RPC>
ZAPP_PUBLIC_LAUNCH_ENABLED=false
NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED=false
ZAPP_REQUIRE_REGISTERED_ASSET=true
ZAPP_NFT_MINT_ENABLED=true
```

Set the Railway healthcheck path to:

```
/api/health
```

Do **not** use `/api/readiness` as the deployment healthcheck. That endpoint intentionally
returns HTTP 503 until the public launch gate is enabled.

Generate a public domain only for `zapp-web`.

## NFT worker

Set:

```
RAILWAY_DOCKERFILE_PATH=Dockerfile.worker
DATABASE_URL=<reference to Postgres DATABASE_URL>
SOLANA_RPC_URL=<production archive Solana RPC>
ZCASH_RPC_URL=<private Zcash RPC>
ZCASH_RPC_USER=<secret>
ZCASH_RPC_PASSWORD=<secret>
ZAPP_NFT_SIGNER_TADDR=<wallet-owned compressed t1 address>
ZCASH_MARKER_ZATS=546
ZAPP_NFT_POSTAGE_ZATS=546
ZAPP_NFT_REVEAL_FEE_ZATS=50000
```

Keep this service private; it needs no public domain.

Use an automatic restart policy for the worker. Railway services are long-running processes,
and restart policies are designed for exactly this workload.

## Migrations

Apply `db/*.sql` to the Railway Postgres instance before starting the web/worker services.

## Gate opening

After the services are running, execute the production preflight and one canary burn.
Only then set both:

```
ZAPP_PUBLIC_LAUNCH_ENABLED=true
NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED=true
```

and redeploy the web service.
