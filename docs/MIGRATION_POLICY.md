# Future ZSA migration policy

This file is intentionally conservative.

A ZApp v1 Proof records a verified historical burn and amount. It does **not** currently
create a Zcash Shielded Asset, and possession of a proof is not a present-day Zcash
consensus right to a future ZSA.

If Zcash activates a compatible custom-asset protocol, ZApp intends to publish a new,
auditable migration version that:

1. freezes a canonical v1 index at an announced Zcash height;
2. publishes the exact set/root of eligible unredeemed proofs;
3. maps base units without floating-point conversion;
4. uses the actually deployed ZSA asset-identifier and issuance rules, not today's drafts;
5. provides a public reconciliation showing total source burns, eligible proofs, migrated
   amount, and remaining amount; and
6. makes any trust or issuer-key assumptions explicit.

No code in v1 labels a proof `redeemed_to_zsa`, because such a state would imply a
capability that does not exist on current Zcash mainnet.
