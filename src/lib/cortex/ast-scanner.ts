// src/lib/cortex/ast-scanner.ts
//
// Gap #5 — Repository AST Scanner.
//
// Production-grade, dependency-light AST symbol extraction. Uses the
// TypeScript compiler API (already a project dependency) for real
// syntactic parsing of TS/JS/TSX/JSX, and a robust regex fallback for
// other supported languages (Python, Go, Rust, Prisma, ...). Replaces the
// naive regex-only extractors used by cortex-init and the live watcher.
//
// Exports:
//   - ExtractedSymbol / ScannedFile
//   - extractSymbols(filePath, content): ExtractedSymbol[]
//   - scanRepository(rootPath): Promise<{ files: ScannedFile[] }>

import ts from 'typescript'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface ExtractedSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method' | 'variable'
  signature: string
  startLine: number
  endLine: number
}

export interface ScannedFile {
  path: string
  language: string
  lineCount: number
  symbols: ExtractedSymbol[]
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb', '.php', '.prisma'])
const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache', 'vendor', '__pycache__', '.venv', 'venv', 'env', 'target', '.zscripts', 'examples', 'mini-services', '.idea', '.vscode', '.cortex', '.vercel'])
const MAX_FILES = 2000
const MAX_DEPTH = 8
const MAX_FILE_BYTES = 256 * 1024

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export function extractSymbols(filePath: string, content: string): ExtractedSymbol[] {
  const ext = path.extname(filePath).toLowerCase()
  if (TS_EXTS.has(ext)) return extractTsSymbols(filePath, content)
  return extractRegexSymbols(filePath, content, ext)
}

function extractTsSymbols(filePath: string, content: string): ExtractedSymbol[] {
  const ext = path.extname(filePath).toLowerCase()
  const scriptKind =
    ext === '.tsx' ? ts.ScriptKind.TSX :
    ext === '.jsx' ? ts.ScriptKind.JSX :
    ext === '.js' || ext === '.mjs' || ext === '.cjs' ? ts.ScriptKind.JS :
    ts.ScriptKind.TS
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)
  const lines = content.split('\n')
  const out: ExtractedSymbol[] = []

  function lineOf(pos: number): number {
    return sf.getLineAndCharacterOfPosition(pos).line + 1
  }
  function endLineOf(node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.end).line + 1
  }
  function nameOf(node: ts.Node): string | null {
    if ('name' in node && node.name) {
      const n = node.name as ts.Node
      if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text
    }
    return null
  }
  function signatureOf(node: ts.Node, name: string): string {
    const start = node.getStart(sf)
    const firstLine = content.slice(start, content.indexOf('\n', start)).trim()
    return firstLine.length > 200 ? firstLine.slice(0, 200) : firstLine
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node)) {
      const name = nameOf(node)
      if (name) out.push({ name, kind: 'function', signature: signatureOf(node, name), startLine: lineOf(node.getStart(sf)), endLine: endLineOf(node) })
    } else if (ts.isClassDeclaration(node)) {
      const name = nameOf(node)
      if (name) out.push({ name, kind: 'class', signature: `class ${name}`, startLine: lineOf(node.getStart(sf)), endLine: endLineOf(node) })
    } else if (ts.isInterfaceDeclaration(node)) {
      const name = nameOf(node)
      if (name) out.push({ name, kind: 'interface', signature: `interface ${name}`, startLine: lineOf(node.getStart(sf)), endLine: endLineOf(node) })
    } else if (ts.isTypeAliasDeclaration(node)) {
      const name = nameOf(node)
      if (name) out.push({ name, kind: 'type', signature: `type ${name}`, startLine: lineOf(node.getStart(sf)), endLine: endLineOf(node) })
    } else if (ts.isEnumDeclaration(node)) {
      const name = nameOf(node)
      if (name) out.push({ name, kind: 'enum', signature: `enum ${name}`, startLine: lineOf(node.getStart(sf)), endLine: endLineOf(node) })
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : null
        if (!name) continue
        const init = decl.initializer
        const isFn = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        out.push({ name, kind: isFn ? 'const' : 'variable', signature: isFn ? `const ${name} = (...) =>` : `const ${name}`, startLine: lineOf(decl.getStart(sf)), endLine: endLineOf(decl) })
      }
    } else if (ts.isMethodDeclaration(node)) {
      const name = nameOf(node)
      if (name) out.push({ name, kind: 'method', signature: signatureOf(node, name), startLine: lineOf(node.getStart(sf)), endLine: endLineOf(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // dedupe by name (keep first occurrence)
  const seen = new Set<string>()
  const uniq: ExtractedSymbol[] = []
  for (const s of out) {
    if (seen.has(s.name)) continue
    seen.add(s.name)
    uniq.push(s)
  }
  void lines
  return uniq.slice(0, 300)
}

function extractRegexSymbols(filePath: string, content: string, ext: string): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = []
  const lines = content.split('\n')
  const push = (name: string, kind: ExtractedSymbol['kind'], startLine: number, signature: string) => {
    if (!name || out.length >= 300) return
    if (out.some((s) => s.name === name)) return
    out.push({ name, kind, signature, startLine, endLine: startLine })
  }

  if (ext === '.py') {
    const re = /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm
    let m
    while ((m = re.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'function', ln, `def ${m[1]}(${m[2]})`)
    }
    const cre = /^\s*class\s+([A-Za-z_][\w]*)/gm
    while ((m = cre.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'class', ln, `class ${m[1]}`)
    }
  } else if (ext === '.prisma') {
    const re = /^model\s+(\w+)/gm
    let m
    while ((m = re.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'class', ln, `model ${m[1]}`)
    }
    const ere = /^enum\s+(\w+)/gm
    while ((m = ere.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'enum', ln, `enum ${m[1]}`)
    }
  } else if (ext === '.go') {
    const re = /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm
    let m
    while ((m = re.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'function', ln, `func ${m[1]}(${m[2]})`)
    }
    const tre = /^type\s+([A-Za-z_][\w]*)\s+/gm
    while ((m = tre.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'type', ln, `type ${m[1]}`)
    }
  } else if (ext === '.rs') {
    const re = /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm
    let m
    while ((m = re.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'function', ln, `fn ${m[1]}(${m[2]})`)
    }
    const scre = /^(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/gm
    while ((m = scre.exec(content)) !== null) {
      const ln = content.slice(0, m.index).split('\n').length
      push(m[1], 'class', ln, `struct ${m[1]}`)
    }
  } else {
    // generic: function/class/interface/const declarations
    const patterns: Array<[RegExp, ExtractedSymbol['kind']]> = [
      [/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, 'function'],
      [/(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, 'class'],
      [/(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, 'interface'],
      [/(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g, 'type'],
      [/(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g, 'enum'],
      [/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, 'const'],
    ]
    for (const [re, kind] of patterns) {
      const r = new RegExp(re.source, re.flags)
      let m
      while ((m = r.exec(content)) !== null) {
        const ln = content.slice(0, m.index).split('\n').length
        push(m[1], kind, ln, `${m[1]}`)
      }
    }
  }
  void lines
  return out
}

export async function scanRepository(rootPath: string): Promise<{ files: ScannedFile[] }> {
  const files: ScannedFile[] = []
  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!SOURCE_EXTS.has(ext)) continue
        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          const content = await fs.readFile(full, 'utf-8')
          const rel = path.relative(rootPath, full).replace(/\\/g, '/')
          files.push({ path: rel, language: ext.slice(1), lineCount: content.split('\n').length, symbols: extractSymbols(rel, content) })
        } catch {
          // skip unreadable
        }
      }
    }
  }
  await walk(rootPath, 0)
  return { files }
}
