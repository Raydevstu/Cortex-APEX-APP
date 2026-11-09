// Step 5: Unattended Live JSONL Transcript & Git AST Symbol Diff Daemon
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ScannedSymbol } from '../indexer/ast-scanner.js';

export interface NormalizedTranscriptTurn {
  turnHash: string;
  platform: 'codex' | 'claude_code' | 'hermes';
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AstSymbolDiff {
  added: ScannedSymbol[];
  modified: ScannedSymbol[];
  deleted: ScannedSymbol[];
}

export class IncrementalJsonlReader {
  private readonly byteOffsets = new Map<string, number>();
  private readonly seenTurnHashes = new Set<string>();

  public readNewLines(filePath: string, platform: 'codex' | 'claude_code' | 'hermes'): NormalizedTranscriptTurn[] {
    if (!fs.existsSync(filePath)) return [];
    const stats = fs.statSync(filePath);
    const prevOffset = this.byteOffsets.get(filePath) ?? 0;
    if (stats.size <= prevOffset) return [];

    const fd = fs.openSync(filePath, 'r');
    const length = stats.size - prevOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, prevOffset);
    fs.closeSync(fd);

    this.byteOffsets.set(filePath, stats.size);
    const chunk = buffer.toString('utf-8');
    const lines = chunk.split('\n').filter((l) => l.trim().length > 0);

    const turns: NormalizedTranscriptTurn[] = [];
    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const normalized = this.normalizeRecord(raw, platform, path.basename(filePath, '.jsonl'));
        if (normalized && !this.seenTurnHashes.has(normalized.turnHash)) {
          this.seenTurnHashes.add(normalized.turnHash);
          turns.push(normalized);
        }
      } catch {
        // Ignore partial line writes
      }
    }
    return turns;
  }

  private normalizeRecord(
    raw: Record<string, unknown>,
    platform: 'codex' | 'claude_code' | 'hermes',
    sessionId: string
  ): NormalizedTranscriptTurn | null {
    const roleRaw = (raw.role || (raw.message as Record<string, unknown>)?.role) as string | undefined;
    if (roleRaw !== 'user' && roleRaw !== 'assistant') return null;

    let content = '';
    if (typeof raw.content === 'string') {
      content = raw.content;
    } else if (typeof (raw.message as Record<string, unknown>)?.content === 'string') {
      content = (raw.message as Record<string, unknown>).content as string;
    } else if (Array.isArray(raw.content)) {
      content = raw.content.map((c: Record<string, unknown>) => c.text || '').join('\n');
    }

    if (!content.trim()) return null;
    const turnHash = crypto.createHash('sha256').update(`${platform}:${sessionId}:${roleRaw}:${content}`).digest('hex');

    return {
      turnHash,
      platform,
      sessionId,
      role: roleRaw,
      content: content.trim(),
      timestamp: Number(raw.timestamp || Date.now())
    };
  }
}

export function diffAstSymbols(prevSymbols: ScannedSymbol[], nextSymbols: ScannedSymbol[]): AstSymbolDiff {
  const prevMap = new Map(prevSymbols.map((s) => [s.id, s]));
  const nextMap = new Map(nextSymbols.map((s) => [s.id, s]));

  const added: ScannedSymbol[] = [];
  const modified: ScannedSymbol[] = [];
  const deleted: ScannedSymbol[] = [];

  for (const [id, nextSym] of nextMap.entries()) {
    const prevSym = prevMap.get(id);
    if (!prevSym) {
      added.push(nextSym);
    } else if (prevSym.signature !== nextSym.signature || prevSym.exported !== nextSym.exported) {
      modified.push(nextSym);
    }
  }

  for (const [id, prevSym] of prevMap.entries()) {
    if (!nextMap.has(id)) {
      deleted.push(prevSym);
    }
  }

  return { added, modified, deleted };
}
