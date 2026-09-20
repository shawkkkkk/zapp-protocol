# ZApp Protocol v1

ZApp is an overlay protocol. It does **not** modify Zcash consensus and does not claim that
ZIP-226/227 assets exist on current Zcash mainnet.

## Goal

Create a public, deterministic relationship between an irreversible Solana token burn and
a compact proof anchored in a standard transparent Zcash mainnet transaction.

## Source event

A valid v1 source transaction MUST:

1. be on Solana mainnet and have `finalized` commitment;
2. execute successfully;
3. contain exactly one top-level `BurnChecked` instruction from SPL Token or Token-2022;
4. contain exactly one memo beginning `ZAPP1:`;
5. place a valid Zcash mainnet legacy transparent address after that prefix; and
6. have the burn authority as a direct signer.

Requiring one burn and one memo deliberately removes matching ambiguity.

## Burn ID

The burn ID is SHA-256 over length-prefixed UTF-8 fields:

- `zapp:burn:v1`
- Solana genesis hash
- Solana transaction signature
- instruction locator (`message:<index>`)
- Solana mint

The amount and destination are not trusted from the proof. Indexers recover them from the
finalized Solana transaction and require an exact match.

## Zcash claim payload

A v1 claim payload is exactly 78 bytes:

| Offset | Bytes | Meaning |
|---|---:|---|
| 0 | 4 | ASCII `ZAPP` |
| 4 | 1 | version = 1 |
| 5 | 1 | operation = 1 (claim) |
| 6 | 32 | raw Solana mint public key |
| 38 | 32 | burn ID |
| 70 | 8 | amount in SPL base units, little-endian uint64 |

The payload is carried in an `OP_RETURN` output. Because it is 78 bytes, the script uses
`OP_RETURN OP_PUSHDATA1 0x4e <payload>`.

The same Zcash transaction MUST contain exactly one marker output of
`ZCASH_MARKER_ZATS` (1000 zatoshis by default) to the destination committed in the Solana
memo. The marker is not the token. It makes the destination independently visible and
machine-checkable.

## Canonical validity

A proof counts if and only if an independent indexer can verify all of the following:

- the payload decodes under this version;
- the referenced Solana mint exists;
- scanning finalized transactions involving that mint reveals the burn whose derived burn ID matches;
- the burn transaction succeeds;
- its exact base-unit amount equals the payload amount;
- its memo contains the Zcash destination;
- the Zcash transaction contains exactly one matching marker output; and
- no earlier valid Zcash claim for that burn ID is already canonical.

A relay key, web server, database row, token name, image, or social account is never a
source of supply.

## Integer safety

All token quantities are uint64 base units and are represented in TypeScript as `bigint`
and in PostgreSQL as `NUMERIC(20,0)`. ZApp never converts token quantities to JavaScript
`number`.

## Reorgs

The indexer stores each processed Zcash block hash. If the canonical hash changes, all
proof state above the common ancestor is invalidated and replayed.

## Versioning

Unknown versions or operations MUST be ignored, not guessed. A future protocol version may
add proof transfer/splitting or native-ZSA migration without changing v1 history.
