import { beforeEach, describe, expect, it, vi } from 'vitest'
import { focusEditorTab } from '../src/lib/editor-tab'

describe('focus an editor result', () => {
  const editorUrl = 'https://cloud.tencent.com/developer/article/write-new'
  beforeEach(() => {
    Object.assign(chrome.tabs, { get: vi.fn(), update: vi.fn() })
  })

  it('focuses the original editor without navigating or creating another draft', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 12, url: editorUrl } as chrome.tabs.Tab)
    expect(await focusEditorTab({ tabId: 12, editorUrl })).toBe(true)
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { active: true })
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('does not focus a reused tab ID with a different document', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 12, url: 'https://example.com/' } as chrome.tabs.Tab)
    expect(await focusEditorTab({ tabId: 12, editorUrl })).toBe(false)
    expect(chrome.tabs.update).not.toHaveBeenCalled()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('does not silently reopen an empty editor when the original tab is gone', async () => {
    vi.mocked(chrome.tabs.get).mockRejectedValue(new Error('No tab'))
    expect(await focusEditorTab({ tabId: 12, editorUrl })).toBe(false)
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('requires the stored tab ID and editor URL', async () => {
    expect(await focusEditorTab({ editorUrl })).toBe(false)
    expect(await focusEditorTab({ tabId: 12 })).toBe(false)
    expect(chrome.tabs.get).not.toHaveBeenCalled()
  })
})
