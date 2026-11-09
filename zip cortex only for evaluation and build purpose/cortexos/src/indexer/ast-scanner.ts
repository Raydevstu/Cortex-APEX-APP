// Step 4: Fast Repository AST Symbol Scanner (TypeScript & Python symbols)
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ScannedSymbol {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type';
  filePath: string;
  signature: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface ScannedFileRecord {
  path: string;
  language: 'typescript' | 'python' | 'json' | 'other';
  sha256: string;
  loc: number;
  symbols: ScannedSymbol[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', '.cortex']);

export class RepositoryAstScanner {
  public async scanWorkspace(repoRoot: string): Promise<ScannedFileRecord[]> {
    const records: ScannedFileRecord[] = [];
    await this.walkDir(repoRoot, repoRoot, records);
    return records;
  }

  private async walkDir(currentDir: string, repoRoot: string, out: ScannedFileRecord[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, repoRoot, out);
      } else if (entry.isFile() && /\.(ts|tsx|py)$/.test(entry.name)) {
        const content = await fs.readFile(fullPath, 'utf-8');
        const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        out.push(this.parseFileSymbols(relPath, content));
      }
    }
  }

  public parseFileSymbols(relPath: string, content: string): ScannedFileRecord {
    const lines = content.split('\n');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const language = relPath.endsWith('.py') ? 'python' : 'typescript';
    const symbols: ScannedSymbol[] = [];

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      if (language === 'typescript') {
        const fnMatch = line.match(/^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/);
        if (fnMatch) {
          symbols.push({
            id: `${relPath}#${fnMatch[3]}`,
            name: fnMatch[3],
            kind: 'function',
            filePath: relPath,
            signature: line.trim().replace(/\{$/, '').trim(),
            startLine: lineNo,
            endLine: lineNo + 10,
            exported: Boolean(fnMatch[1])
          });
        }
        const clsMatch = line.match(/^(export\s+)?(class|interface|type)\s+([A-Za-z0-9_]+)/);
        if (clsMatch) {
          symbols.push({
            id: `${relPath}#${clsMatch[3]}`,
            name: clsMatch[3],
            kind: clsMatch[2] as 'class' | 'interface' | 'type',
            filePath: relPath,
            signature: line.trim().replace(/\{$/, '').trim(),
            startLine: lineNo,
            endLine: lineNo + 20,
            exported: Boolean(clsMatch[1])
          });
        }
      } else if (language === 'python') {
        const pyMatch = line.match(/^\s*(def|class)\s+([A-Za-z0-9_]+)\s*[(:]/);
        if (pyMatch) {
          symbols.push({
            id: `${relPath}#${pyMatch[2]}`,
            name: pyMatch[2],
            kind: pyMatch[1] === 'class' ? 'class' : 'function',
            filePath: relPath,
            signature: line.trim(),
            startLine: lineNo,
            endLine: lineNo + 15,
            exported: !pyMatch[2].startsWith('_')
          });
        }
      }
    });

    return {
      path: relPath,
      language,
      sha256,
      loc: lines.length,
      symbols
    };
  }
}
