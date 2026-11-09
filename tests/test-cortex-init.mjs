import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(process.argv[2] || 'D:/Projects/GLM CORTEXT ORCASTRATOR')
const INIT = path.join(ROOT, 'scripts', 'cortex-init.mjs')

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cortex-init-'))
  try {
    await (await import('node:fs/promises')).writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'init-test-app', dependencies: { next: '15.0.0', zod: '^4.0.0' }, devDependencies: { typescript: '^5' } }))
    await (await import('node:fs/promises')).mkdir(path.join(dir, 'src', 'lib'), { recursive: true })
    await (await import('node:fs/promises')).writeFile(path.join(dir, 'src', 'lib', 'a.ts'), 'export function foo() { return 1 }\n')

    execFileSync(process.execPath, [INIT, '--root', dir, '--no-daemon', '--no-wire'], { stdio: 'pipe' })

    const cortex = path.join(dir, '.cortex')
    for (const f of ['project-dna.json', 'continuity-ledger.json', 'active-scope-lock.json', 'seed-graph.cypher']) {
      await readFile(path.join(cortex, f))
    }
    const dna = JSON.parse(await readFile(path.join(cortex, 'project-dna.json'), 'utf-8'))
    if (!dna.projectMeta || !dna.techStack || !dna.codingStandards?.astScopeGuardRules) throw new Error('DNA shape invalid')
    if (dna.techStack.frontend.framework !== 'Next.js 15.0.0') throw new Error('stack fingerprint wrong: ' + dna.techStack.frontend.framework)
    const ledger = JSON.parse(await readFile(path.join(cortex, 'continuity-ledger.json'), 'utf-8'))
    if (!ledger.activeTask || !Array.isArray(ledger.relevantSymbols)) throw new Error('ledger shape invalid')
    const lock = JSON.parse(await readFile(path.join(cortex, 'active-scope-lock.json'), 'utf-8'))
    if (!Array.isArray(lock.allowedWriteFiles) || !Array.isArray(lock.forbiddenPatterns)) throw new Error('scope lock shape invalid')
    const cypher = await readFile(path.join(cortex, 'seed-graph.cypher'), 'utf-8')
    if (!cypher.includes('ModuleNode') || !cypher.includes('FileNode')) throw new Error('seed graph incomplete')

    // idempotency: re-run should not crash
    execFileSync(process.execPath, [INIT, '--root', dir, '--no-daemon', '--no-wire', '--slug', 'init-test-app'], { stdio: 'pipe' })

    console.log('ALL_INIT_TESTS_PASSED')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1) })
