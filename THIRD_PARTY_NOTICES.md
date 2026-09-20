# Third-party protocol notice

ZApp's Zcash inscription envelope is independently implemented from the published
**Universe Zerdinals v1 specification** by bitcoinuniverseio.

The published specification is licensed CC BY 4.0. ZApp uses the documented interoperable
`ord` scriptSig envelope, 240-byte piece layout, P2SH commit/reveal construction,
`UZRD1` content commitment, and carrying-output ownership convention.

Published specification:
https://github.com/bitcoinuniverseio/docs-zerdinals-and-zrunes/blob/develop/src/content/docs/protocols/zerdinals-v1.md

ZApp does not copy or depend on the competitor ZcashMEME/STAMP source implementation.
ZApp's Solana burn rules, ZApp proof payload, NFT receipt schema, launch registry,
cross-chain verifier, worker, indexer, state root and migration policy are ZApp-specific.

"Zerdinals" and "ZRunes" are names/marks of their respective project owners; this notice
does not imply affiliation.
