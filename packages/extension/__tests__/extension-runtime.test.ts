import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { ExtensionRuntime } = await vi.importActual<typeof import('../src/runtime/extension')>('../src/runtime/extension')

describe('extension tab runtime', () => {
  let updates: Set<(id: number, info: chrome.tabs.TabChangeInfo) => void>
  let removals: Set<(id: number) => void>
  let chromeApi: any

  beforeEach(() => {
    vi.useFakeTimers()
    updates = new Set()
    removals = new Set()
    chromeApi = {
      tabs: {
        get: vi.fn().mockResolvedValue({ status: 'loading' }),
        onUpdated: { addListener: vi.fn(listener => updates.add(listener)), removeListener: vi.fn(listener => updates.delete(listener)) },
        onRemoved: { addListener: vi.fn(listener => removals.add(listener)), removeListener: vi.fn(listener => removals.delete(listener)) },
      },
      scripting: { executeScript: vi.fn() },
    }
    vi.stubGlobal('chrome', chromeApi)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('handles an already loaded tab and removes both listeners', async () => {
    chromeApi.tabs.get.mockResolvedValue({ status: 'complete' })
    await new ExtensionRuntime().tabs.waitForLoad(7)
    expect(updates.size).toBe(0)
    expect(removals.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('subscribes before reading tab status and handles a fast complete event', async () => {
    chromeApi.tabs.get.mockImplementation(() => {
      expect(updates.size).toBe(1)
      for (const listener of updates) listener(7, { status: 'complete' })
      return Promise.resolve({ status: 'loading' })
    })
    await new ExtensionRuntime().tabs.waitForLoad(7)
    expect(updates.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects when the tab closes and cleans up listeners', async () => {
    const pending = new ExtensionRuntime().tabs.waitForLoad(7)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    for (const listener of removals) listener(7)
    await rejected
    expect(updates.size).toBe(0)
    expect(removals.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up on timeout and status lookup failure', async () => {
    const pending = new ExtensionRuntime().tabs.waitForLoad(7, 20)
    const rejected = expect(pending).rejects.toThrow('Tab load timeout')
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(updates.size).toBe(0)
    expect(removals.size).toBe(0)
    chromeApi.tabs.get.mockRejectedValue(new Error('No tab'))
    await expect(new ExtensionRuntime().tabs.waitForLoad(8)).rejects.toThrow('No tab')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses MAIN world and awaits the page result', async () => {
    chromeApi.scripting.executeScript.mockResolvedValue([{ result: { success: true } }])
    const func = async () => ({ success: true })
    expect(await new ExtensionRuntime().tabs.executeScript(7, func, [])).toEqual({ success: true })
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, world: 'MAIN', func, args: [] })
  })

  it('rejects an injection with no frame result', async () => {
    chromeApi.scripting.executeScript.mockResolvedValue([])
    await expect(new ExtensionRuntime().tabs.executeScript(7, () => undefined, [])).rejects.toThrow('未返回结果')
  })
})
