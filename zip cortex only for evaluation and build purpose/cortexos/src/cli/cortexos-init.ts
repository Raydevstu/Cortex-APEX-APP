#!/usr/bin/env node
// Step 4: `npx cortexos init` Zero-Config Bootstrap CLI
import fs from 'node:fs/promises';
import path from 'node:path';
import { RepositoryAstScanner } from '../indexer/ast-scanner.js';

async function runInit() {
  const repoRoot = process.cwd();
  console.log('[CortexOS Init] Scanning repository AST & seeding local graph snapshot...');
  const scanner = new RepositoryAstScanner();
  const files = await scanner.scanWorkspace(repoRoot);

  const totalSymbols = files.reduce((acc, f) => acc + f.symbols.length, 0);
  const snapshotPath = path.join(repoRoot, '.cortex', 'graph-snapshot.json');
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(
    snapshotPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), fileCount: files.length, totalSymbols, files }, null, 2),
    'utf-8'
  );

  console.log(`[CortexOS Init] Indexed ${files.length} files and ${totalSymbols} AST symbols into .cortex/graph-snapshot.json`);
}

runInit().catch((err) => {
  console.error('[CortexOS Init] Failed:', err);
  process.exit(1);
});
