import type { SyncOutcome } from '@wechatsync/core'

/** A returned editor handoff is complete as a task, but the article is not saved yet. */
export interface ResultStatus {
  success: boolean
  outcome?: SyncOutcome
}

export function isPendingResult(result: ResultStatus): boolean {
  return result.outcome === 'editor_filled' || result.outcome === 'needs_user_action'
}

export function isSuccessfulResult(result: ResultStatus): boolean {
  return !isPendingResult(result) && result.outcome !== 'failed' && result.success
}

export function isFailedResult(result: ResultStatus): boolean {
  return !isPendingResult(result) && !isSuccessfulResult(result)
}

export function summarizeSyncResults(results: readonly ResultStatus[]) {
  return {
    success: results.filter(isSuccessfulResult).length,
    pending: results.filter(isPendingResult).length,
    failed: results.filter(isFailedResult).length,
  }
}
