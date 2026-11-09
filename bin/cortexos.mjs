#!/usr/bin/env node
/**
 * File: bin/cortexos.mjs
 * The `cortexos` bin entry (package.json → "bin") — a thin wrapper around
 * the Phase 5 unified CLI implementation in scripts/cortexos-cli.mjs.
 *
 * Usage (after `npm link` / `npm install -g .`):  cortexos <command> …
 * Direct:                                        node bin/cortexos.mjs <command> …
 */
import { runCli, DaemonHttpError } from '../scripts/cortexos-cli.mjs'

runCli(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    const detail = error instanceof DaemonHttpError
      ? `${error.message} (HTTP ${error.status})`
      : error?.cause?.code === 'ECONNREFUSED' || error instanceof TypeError
        ? `${error.message}\n  Is the CortexOS daemon running? Set CORTEX_DAEMON_URL or pass --daemon-url.`
        : error.message
    console.error(`cortexos: ${detail}`)
    process.exit(1)
  })
