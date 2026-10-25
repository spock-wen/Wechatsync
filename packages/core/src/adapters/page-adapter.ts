import { CodeAdapter } from './code-adapter'
import { fillPageEditor } from './page-editor'
import type { PageEditorPlatform, PageEditorResponse } from './page-editor'
import type { PublishOptions } from './types'
import type { Article, SyncResult } from '../types'

/**
 * 页面适配器负责把内容交给站点编辑器，保存/发布由用户确认。
 * DOM 操作封装在注入函数内，不在 Service Worker 中执行。
 */
export abstract class PageAdapter extends CodeAdapter {
  protected abstract readonly editorPlatform: PageEditorPlatform
  protected abstract readonly editorUrl: string

  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
    // 保留 Markdown 平台常用的链接、表格与代码块。
    removeLinks: false,
    convertTablesToText: false,
    normalizeViaMarkdown: false,
  }

  async publish(article: Article, _options?: PublishOptions): Promise<SyncResult> {
    let tabId: number | undefined
    let editorUrl = this.editorUrl

    try {
      if (!article.title.trim() || !article.markdown.trim()) {
        throw new Error('文章标题和 Markdown 正文不能为空')
      }

      const tabs = this.runtime.tabs
      if (!tabs) {
        throw new Error('当前运行环境不支持打开浏览器编辑器')
      }

      const auth = await this.checkAuth()
      if (!auth.isAuthenticated) {
        throw new Error(auth.error || `请先登录${this.meta.name}`)
      }

      // 每次使用新标签页，避免覆盖用户正在编辑的文章。
      const tab = await tabs.create(this.editorUrl, true)
      tabId = tab.id
      await tabs.waitForLoad(tab.id)

      const result: PageEditorResponse | undefined = await tabs.executeScript(
        tab.id,
        fillPageEditor,
        [{
          platform: this.editorPlatform,
          title: article.title,
          markdown: article.markdown,
          timeoutMs: 20000,
        }]
      )

      if (result?.url) {
        const currentUrl = new URL(result.url)
        if (currentUrl.origin !== new URL(this.editorUrl).origin) {
          throw new Error(`编辑器跳转到其他站点，请重新登录${this.meta.name}`)
        }
        editorUrl = currentUrl.href
      }

      if (result?.success !== true) {
        throw new Error(result?.error || '未能确认标题和正文已填入编辑器，请打开编辑器检查')
      }

      const warnings = /!\[|<img\b/i.test(article.markdown)
        ? ['图片保留原始链接，尚未确认转存到目标平台，请在保存前检查图片。']
        : undefined

      return this.createResult(false, {
        outcome: 'editor_filled',
        editorUrl,
        tabId,
        message: `已填入${this.meta.name}编辑器，请检查内容并手动保存草稿；尚未确认保存。`,
        ...(warnings ? { warnings } : {}),
      })
    } catch (error) {
      return this.createResult(false, {
        outcome: 'failed',
        editorUrl,
        ...(tabId !== undefined ? { tabId } : {}),
        error: error instanceof Error ? error.message : '打开或填充编辑器失败',
      })
    }
  }
}
