/**
 * Phase 5 — POST /api/cortex/memory/extract
 * (blueprint PHASE_5 §3.2: the git-hook loop's canonical extraction URL).
 *
 * Alias of the Phase 3 Engine 3 route (`POST /api/cortex/extract`) so both
 * the original contract and the Phase 5 `cortexos hooks run-post-commit`
 * loop address the same Automatic Memory Extractor.
 */
import { POST as extractPost } from '@/app/api/cortex/extract/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const POST = extractPost
