# Security

ZApp destroys real tokens and can spend real ZEC for proof relay. Treat mainnet deployment
as financial infrastructure.

## Reporting

Do not publish an exploit that can redirect claims, inflate canonical supply, double-claim
a burn, or drain the relay wallet before maintainers have had an opportunity to patch it.
Use GitHub's private vulnerability reporting if enabled for this repository.

## Invariants

A security fix MUST preserve these invariants:

- no ZApp Proof exists without a successfully finalized Solana burn;
- proof amount exactly equals BurnChecked base units;
- proof mint exactly equals the burned mint;
- the Zcash destination was committed inside the finalized Solana transaction;
- one burn ID can become canonical at most once;
- relay/operator identity is irrelevant to canonical validity;
- no floating-point or unsafe JavaScript-number token accounting;
- Zcash transaction IDs are accepted only after the node returns them from a real broadcast.

## Production key separation

The web process should not hold raw Zcash private keys. It should access a dedicated wallet
RPC on a private network segment. Keep only a small relay balance hot.

The Postgres user used by the public API should not have infrastructure-administration
credentials. The independent indexer should be capable of rebuilding canonical state into
a fresh database.

## Before accepting public funds

Complete the mainnet smoke-test checklist in `docs/OPERATIONS.md`, review dependencies,
pin a lockfile, and have the cross-chain validity rules independently reviewed.
