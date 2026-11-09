import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const mod = await import('/D:/Projects/GLM CORTEXT ORCASTRATOR/src/lib/cortex/ast-scanner.ts')
const { extractSymbols, scanRepository } = mod

let passed = 0
function assert(cond, msg) { if (!cond) throw new Error(msg); passed++ }

// TS extraction
const tsCode = `
export function foo(a: number): number { return a + 1 }
export const bar = (x: string) => x.trim()
export class Baz { method() {} }
export interface Qux { id: string }
export type Id = string
export enum Color { Red, Blue }
`
const tsSyms = extractSymbols('src/x.ts', tsCode)
assert(tsSyms.some(s => s.name === 'foo' && s.kind === 'function'), 'foo function')
assert(tsSyms.some(s => s.name === 'bar' && s.kind === 'const'), 'bar const arrow')
assert(tsSyms.some(s => s.name === 'Baz' && s.kind === 'class'), 'Baz class')
assert(tsSyms.some(s => s.name === 'Qux' && s.kind === 'interface'), 'Qux interface')
assert(tsSyms.some(s => s.name === 'Id' && s.kind === 'type'), 'Id type')
assert(tsSyms.some(s => s.name === 'Color' && s.kind === 'enum'), 'Color enum')
const fooSym = tsSyms.find(s => s.name === 'foo')
assert(fooSym && fooSym.startLine >= 2, 'line numbers')

// Python
const pyCode = `def greet(name):\n    return name\nclass Foo:\n    pass\n`
const pySyms = extractSymbols('a.py', pyCode)
assert(pySyms.some(s => s.name === 'greet' && s.kind === 'function'), 'py greet')
assert(pySyms.some(s => s.name === 'Foo' && s.kind === 'class'), 'py Foo')

// scanRepository
const dir = await mkdtemp(path.join(tmpdir(), 'astscan-'))
try {
  await mkdir(path.join(dir, 'src'), { recursive: true })
  await writeFile(path.join(dir, 'src', 'a.ts'), 'export function alpha() {}\n')
  await writeFile(path.join(dir, 'src', 'b.py'), 'def beta(): pass\n')
  const { files } = await scanRepository(dir)
  assert(files.length === 2, 'two files scanned')
  assert(files.some(f => f.path === 'src/a.ts' && f.symbols.some(s => s.name === 'alpha')), 'alpha found')
  assert(files.some(f => f.path === 'src/b.py' && f.symbols.some(s => s.name === 'beta')), 'beta found')
  console.log('ALL_AST_SCANNER_TESTS_PASSED', `(${passed} assertions)`)
} finally {
  await rm(dir, { recursive: true, force: true })
}
