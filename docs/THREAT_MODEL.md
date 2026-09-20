# Threat model

## Forged Zcash proof

**Attack:** Put a syntactically valid ZAPP payload on Zcash without burning anything.

**Result:** Invalid. No finalized Solana burn produces the committed burn ID.

## Inflate the amount

**Attack:** Burn 10 tokens and write 100 into the Zcash payload.

**Result:** Invalid. Indexers compare exact uint64 base units.

## Steal another user's burn

**Attack:** Observe a burn and create a Zcash transaction paying the marker to the attacker.

**Result:** Invalid. The recipient was committed in the finalized Solana memo before the
Zcash transaction existed.

An attacker may pay to anchor the *correct* proof for the real burner. That is harmless.

## Double claim

**Attack:** Place the same burn in multiple Zcash transactions.

**Result:** Only the earliest valid claim in canonical Zcash chain order counts.

## Fake relay/database entry

**Attack:** Compromise ZApp's API or Postgres database.

**Result:** The canonical index can be rebuilt from Solana and Zcash. Database content alone
cannot create a proof.

## Solana rollback

ZApp accepts only `finalized` source transactions.

## Zcash reorg

Indexed block hashes are checked on every synchronization pass. Claims above a detected
fork are invalidated and replayed.

## RPC censorship or incomplete history

A bad RPC can hide burns or blocks and create an incomplete view, but it cannot make an
invalid proof pass cryptographic/transaction checks. Production should run multiple
independent RPCs/indexers and compare state roots.

## Spam / relay-drain risk

The protocol is permissionless; the sponsored relay is not. Production deployments should
set a service fee, rate limit, or relay budget. Anyone can independently construct and pay
for a valid Zcash proof without the official relay.

## What ZApp cannot guarantee today

ZApp cannot make ZIP-226/227 active on Zcash mainnet. It cannot make today's proofs native
shielded assets. Future migration depends on the consensus rules that actually ship and on
the migration mechanism adopted at that time.
