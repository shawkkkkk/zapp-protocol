# ZApp Protocol v1

ZApp is an overlay protocol. It does **not** modify Zcash consensus and does not claim that
ZIP-226/227 assets exist on current Zcash mainnet.

## Goal

Provide a public asset-launchpad workaround before native Zcash custom assets exist:
a finalized Solana token burn produces a collectible Zcash inscription/NFT. The NFT reveal
also carries a compact ZApp proof so its mint, amount and destination can be independently
reconstructed from both chains.

## Source event

A valid v1 source transaction MUST:

1. be on Solana mainnet and have `finalized` commitment;
2. execute successfully;
3. contain exactly one `BurnChecked` across both top-level and inner instructions;
4. have that burn be top-level and executed by SPL Token or Token-2022;
5. contain exactly one top-level memo from any supported deployed Memo program, beginning `ZAPP1:`;
6. place a valid Zcash mainnet legacy transparent address after that prefix;
7. have the burn authority as a direct signer;
8. have `preTokenBalances` identify that authority as the source token-account owner;
9. reject system/incinerator-owned token accounts;
10. have the source balance decrease equal the exact `BurnChecked` uint64 amount; and
11. have the `BurnChecked` decimals byte agree with the recorded source-token decimals when available.

Canonical verification uses raw Solana instruction bytes (`encoding: "json"`), resolves
address-lookup-table keys, and supports transaction versions through v1. `jsonParsed` is
not a source of protocol truth.

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

For the public NFT flow, the claim payload is carried by the inscription reveal transaction.
That same reveal MUST create output 0 with `ZCASH_MARKER_ZATS` (546 zatoshis by default)
to the destination committed in the Solana memo. Output 0 is the inscription's carrying
output and initial ownership outpoint.

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

## NFT ownership

Initial ownership is output 0 of the completed inscription reveal.

After that, ownership follows the Zcash inscription carrying-output rule rather than requiring
a ZApp-aware wallet:

1. when the current carrying output is spent, scan the spending transaction's outputs in
   output-index order;
2. the first transparent, non-data output becomes the new carrying output;
3. its transparent address becomes the current owner; and
4. if no transparent non-data successor exists, ownership becomes terminal and is never
   guessed from later activity.

This means an ordinary transparent Zcash transfer can move a ZApp NFT. A wallet does not
need to add a special ZApp payload for the indexer to follow it.

ZApp operation 2 remains available as optional transfer metadata for ZApp-aware tooling:

| Offset | Bytes | Meaning |
|---|---:|---|
| 0 | 4 | ASCII `ZAPP` |
| 4 | 1 | version = 1 |
| 5 | 1 | operation = 2 (transfer annotation) |
| 6 | 32 | burn ID |

The indexer journals transfers and terminal spends by block height/hash and rolls them back
during reorg recovery.

## Operator independence and rescue

The official relay is convenience infrastructure, not an issuer. Anyone can independently
verify a finalized burn and pay to anchor the same valid Proof. The repository ships
`relay:proof` specifically so an official-relay outage does not strand a finalized burn.

The first valid claim in canonical Zcash chain order wins for a burn ID. A third party may
pay to deliver the correct Proof to the burner-selected destination; they cannot redirect it.

## Canonical state root

An indexer publishes a SHA-256 state root over all confirmed Proofs ordered by burn ID.
Each row commits to:

`burn_id | mint | amount_base_units | current_owner | owner_txid | owner_vout | ownership_state`

prefixed by the domain string `ZAPP_STATE_V1\n`. Two independent indexers at the same
Zcash block hash should publish the same root, proof count and per-mint base-unit totals.
A mismatch is an auditable signal that one indexer has incomplete or divergent chain data.
