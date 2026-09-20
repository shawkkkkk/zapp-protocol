import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];
let shuttingDown = false;

function start(label: string, script: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", script, "--watch"],
    { stdio: "inherit", env: process.env },
  );
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `${label} exited unexpectedly (code=${String(code)} signal=${String(signal)})`,
    );
    shutdown(code === 0 ? 1 : code || 1);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

start("nft-worker", "scripts/nft-worker.ts");

if (process.env.ZAPP_INDEXER_ENABLED === "true") {
  console.log("ZApp backend: Zcash indexer enabled");
  start("zcash-indexer", "scripts/index-zcash.ts");
} else {
  console.log("ZApp backend: Zcash indexer disabled until mainnet relay is configured");
}


if (process.env.ZAPP_SOLANA_WATCHER_ENABLED === "true") {
  console.log("ZApp backend: Solana burn watcher enabled");
  start("solana-watcher", "scripts/watch-solana.ts");
} else {
  console.log("ZApp backend: Solana burn watcher disabled until production RPC is configured");
}
