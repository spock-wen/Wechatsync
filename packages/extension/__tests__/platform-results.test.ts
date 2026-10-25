import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlatformList } from '../src/components/sync-dialog/PlatformList.tsx'
import type { SyncResult } from '../src/components/sync-dialog/types'

function renderResults(results: SyncResult[]) {
  return renderToStaticMarkup(createElement(PlatformList, {
    platforms: results.map(result => ({ id: result.platform, name: result.platform, icon: 'icon.png', isAuthenticated: true })),
    selected: new Set(results.map(result => result.platform)),
    selectedPlatforms: results.map(result => result.platform),
    status: 'completed',
    results,
    platformProgress: new Map(),
    onToggle: () => {},
    onSelectAll: () => {},
  }))
}

describe('platform result rendering', () => {
  it('shows editor handoffs as pending with actionable instructions and image warnings', () => {
    const html = renderResults([{
      platform: 'tencentcloud',
      success: false,
      outcome: 'editor_filled',
      editorUrl: 'https://cloud.tencent.com/developer/article/write-new',
      message: '请在编辑器保存草稿',
      warnings: ['请检查图片是否完成转存'],
    }])
    expect(html).toContain('1 待保存')
    expect(html).toContain('打开编辑器')
    expect(html).toContain('请在编辑器保存草稿')
    expect(html).toContain('请检查图片是否完成转存')
    expect(html).not.toContain('bg-red-50')
    expect(html).not.toContain('bg-green-50')
  })

  it('keeps real failures distinct and provides the failed editor for inspection', () => {
    const html = renderResults([{
      platform: 'aliyun',
      success: false,
      outcome: 'failed',
      editorUrl: 'https://developer.aliyun.com/article/new#/',
      error: '正文回读不一致',
    }])
    expect(html).toContain('正文回读不一致')
    expect(html).toContain('打开编辑器')
    expect(html).toContain('bg-red-50')
    expect(html).not.toContain('待保存')
  })
})
