// Step 3: Universal Model Context Protocol (MCP) Server for Codex, Hermes, Claude Code, Cursor
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalOllamaPipeline } from '../engine/local-ollama-pipeline.js';
import type { CrossPlatformSyncPacket, PlatformId } from '../types/cortex-contracts.js';

export class CortexMcpServer {
  private readonly repoRoot: string;
  private readonly pipeline: LocalOllamaPipeline;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
    this.pipeline = new LocalOllamaPipeline(repoRoot);
  }

  public getToolDefinitions() {
    return [
      {
        name: 'cortex_pull_delta_sync',
        description: 'Pull compact cross-platform Project DNA + active task scope + recent session memory (<450 tokens).',
        inputSchema: {
          type: 'object',
          required: ['platform'],
          properties: {
            platform: { type: 'string', enum: ['codex', 'claude_code', 'hermes', 'cursor', 'opencode', 'web_chat'] }
          }
        }
      },
      {
        name: 'cortex_rewrite_and_preexecute',
        description: 'Run local Ollama router + local AST/git pre-execution + Tier-1 prompt specification and lock allowedWriteFiles.',
        inputSchema: {
          type: 'object',
          required: ['rawPrompt'],
          properties: {
            rawPrompt: { type: 'string' },
            activeFiles: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      {
        name: 'cortex_commit_turn_memory',
        description: 'Extract architectural decisions, task progress, and AST symbol deltas from a completed turn.',
        inputSchema: {
          type: 'object',
          required: ['platform', 'userPrompt', 'assistantResponse'],
          properties: {
            platform: { type: 'string' },
            userPrompt: { type: 'string' },
            assistantResponse: { type: 'string' },
            modifiedFiles: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    ];
  }

  public async pullDeltaSync(platform: PlatformId): Promise<CrossPlatformSyncPacket> {
    const dna = await this.pipeline.loadProjectDNA();
    const scopePath = path.join(this.repoRoot, '.cortex', 'active-task-scope.json');
    let activeTask = {
      id: 'task_bootstrap',
      title: 'Initial Repository Scope',
      allowedWriteFiles: ['src/']
    };
    try {
      const scopeRaw = JSON.parse(await fs.readFile(scopePath, 'utf-8'));
      activeTask = {
        id: scopeRaw.activeTaskId,
        title: scopeRaw.taskTitle,
        allowedWriteFiles: scopeRaw.allowedWriteFiles
      };
    } catch {
      // Default scope if none locked yet
    }

    const compactContextHeader = [
      `[CortexOS Sync | Project: ${dna.project.name} | Platform: ${platform}]`,
      `Stack: ${dna.techStack.languages.join('/')} + ${dna.techStack.databases.join(', ')}`,
      `Active Task (${activeTask.id}): ${activeTask.title}`,
      `Allowed Write Files: ${activeTask.allowedWriteFiles.join(', ')}`,
      `Immutable Rules: ${dna.architecture.immutableRules.join(' | ')}`
    ].join('\n');

    return {
      packetId: `sync_${Date.now()}`,
      generatedAt: Date.now(),
      projectId: dna.project.id,
      activeTask,
      recentDecisions: dna.architecture.immutableRules,
      recentTurnSummaries: [],
      compactContextHeader
    };
  }
}
