import { describe, expect, it } from 'vitest'
import { isFailedResult, isPendingResult, isSuccessfulResult, summarizeSyncResults } from '../src/lib/sync-result'

describe('sync result classification', () => {
  it('keeps legacy success and failure results compatible', () => {
    expect(isSuccessfulResult({ success: true })).toBe(true)
    expect(isFailedResult({ success: false })).toBe(true)
  })

  it.each(['editor_filled', 'needs_user_action'] as const)('keeps %s out of success and retry lists', outcome => {
    const result = { success: false, outcome }
    expect(isPendingResult(result)).toBe(true)
    expect(isSuccessfulResult(result)).toBe(false)
    expect(isFailedResult(result)).toBe(false)
    expect(isSuccessfulResult({ ...result, success: true })).toBe(false)
  })

  it.each(['draft_saved', 'published'] as const)('accepts confirmed %s results', outcome => {
    expect(isSuccessfulResult({ success: true, outcome })).toBe(true)
    expect(isPendingResult({ success: true, outcome })).toBe(false)
  })

  it('does not treat an explicit failure as successful even with a stale success flag', () => {
    expect(isFailedResult({ success: true, outcome: 'failed' })).toBe(true)
  })

  it('summarizes mixed results and only retries genuine failures', () => {
    const results = [
      { platform: 'old', success: true },
      { platform: 'cloud', success: false, outcome: 'editor_filled' as const },
      { platform: 'draft', success: true, outcome: 'draft_saved' as const },
      { platform: 'broken', success: false, outcome: 'failed' as const },
    ]
    expect(summarizeSyncResults(results)).toEqual({ success: 2, pending: 1, failed: 1 })
    expect(results.filter(isFailedResult).map(result => result.platform)).toEqual(['broken'])
    expect(results.filter(result => !isFailedResult(result)).map(result => result.platform)).toEqual(['old', 'cloud', 'draft'])
  })
})
