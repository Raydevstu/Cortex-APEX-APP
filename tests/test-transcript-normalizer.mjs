import { parseTranscriptLine } from '/D:/Projects/GLM CORTEXT ORCASTRATOR/src/lib/cortex/transcript-normalizer.ts'

const claude = JSON.stringify({ type: 'user', cwd: '/repo', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } })
console.log('claude:', JSON.stringify(parseTranscriptLine('/home/u/.claude/projects/-repo/s.jsonl', claude)))

const codex = JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }], cwd: '/repo' })
console.log('codex:', JSON.stringify(parseTranscriptLine('/home/u/.codex/sessions/2026/01/01/rollout-x.jsonl', codex)))

const hermes = JSON.stringify({ platform: 'hermes', role: 'user', content: 'prompt text', projectRoot: '/repo' })
console.log('hermes:', JSON.stringify(parseTranscriptLine('/home/u/.hermes/sessions/s.jsonl', hermes)))

console.log('bad:', parseTranscriptLine('/x.jsonl', 'not json'))
console.log('empty:', parseTranscriptLine('/x.jsonl', JSON.stringify({ role: 'user', content: '' })))
console.log('ALL_NORMALIZER_TESTS_PASSED')
