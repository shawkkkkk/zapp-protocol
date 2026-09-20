# ZApp NFT model

ZApp exists because native custom assets are not active on Zcash mainnet today.

The product model is deliberately simple:

1. launch or select an SPL / Token-2022 asset on Solana;
2. burn an amount of that asset in a finalized Solana transaction;
3. commit the destination Zcash transparent address in the same transaction;
4. mint a collectible Zcash inscription/NFT containing the canonical burn record;
5. track that NFT's current owner on Zcash; and
6. treat that NFT as the protocol claim object for any future migration policy.

The NFT is real today. The burn is real today. A native shielded asset is not.

## Canonical NFT body

Content type: `application/json`

Canonical UTF-8 body:

```json
{"p":"zapp","op":"mint","v":1,"mint":"<solana-mint>","burn":"<solana-signature>","burnId":"<32-byte-hex>","amt":"<raw-base-units>","to":"<zcash-t-address>"}
```

Field order, absence of whitespace, string encoding of `amt`, and exact protocol/version
are part of canonical validity.

An inscription alone does not create supply. The cross-chain verifier still requires the
referenced finalized Solana burn, exact mint, exact amount, owner/signature checks and exact
recipient.

## Two layers

ZApp intentionally separates:

- **NFT layer:** the collectible/claim object users receive on Zcash;
- **Proof layer:** compact machine-verifiable protocol data used for indexers, duplicate
  protection, ownership lineage and independent state reconstruction.

The NFT is the product object. The Proof layer makes it harder to fake, inflate or lose
track of the object.

## Future native asset migration

A ZApp NFT is not itself a ZSA and must not be marketed as one. If compatible native assets
activate later, the migration snapshot can use canonical NFT ownership and the burn amount
recorded and independently reverified by ZApp.

The migration policy remains versioned and auditable rather than being represented as a
current Zcash consensus guarantee.
