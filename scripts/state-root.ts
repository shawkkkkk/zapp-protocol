import { canonicalState } from "../src/lib/server/state.ts";

console.log(JSON.stringify(await canonicalState(), null, 2));
