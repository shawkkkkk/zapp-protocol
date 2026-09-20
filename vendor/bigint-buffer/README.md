# ZApp bigint-buffer compatibility package

This local package implements the four-function public API consumed by the Solana
legacy dependency graph:

- `toBigIntLE`
- `toBigIntBE`
- `toBufferLE`
- `toBufferBE`

It is intentionally pure JavaScript and performs explicit type, width, and overflow
checks. It replaces the abandoned native `bigint-buffer` dependency whose native
conversion path is affected by GHSA-3gc7-fjrx-p6mg.

The package name is retained only for dependency compatibility. This implementation
is maintained inside ZApp and does not load a native addon.
