export type PageEditorPlatform = 'tencentcloud' | 'aliyun' | 'huaweicloud'

export interface PageEditorRequest {
  platform: PageEditorPlatform
  title: string
  markdown: string
  timeoutMs?: number
}

export interface PageEditorResponse {
  success: boolean
  error?: string
  message?: string
  url?: string
}

/**
 * Runs in the target page's MAIN world. Keep every runtime helper inside this
 * function: chrome.scripting serializes the function without its module scope.
 * This fills an editor only; it never clicks save or publish.
 */
export async function fillPageEditor(request: PageEditorRequest): Promise<PageEditorResponse> {
  type TextInput = HTMLInputElement | HTMLTextAreaElement
  type CodeMirror = { getValue(): string; setValue(value: string): void }
  type CodeMirror6View = {
    contentDOM: HTMLElement
    state: { doc: { length: number; toString(): string }; readOnly?: boolean }
    dispatch(transaction: { changes: { from: number; to: number; insert: string } }): void
  }
  type CodeMirror6Content = HTMLElement & {
    cmView?: { rootView?: { view?: CodeMirror6View } }
    cmTile?: { root?: { view?: CodeMirror6View } }
  }
  type HuaweiEditor = {
    editor_id?: string
    getContent?(options?: { format: string }): unknown
    setContent(value: string): unknown
  }
  type HuaweiModal = { currentEditorType?: string; currentEditor?: HuaweiEditor }

  const deadline = Date.now() + Math.max(0, Math.min(request.timeoutMs ?? 20000, 30000))
  const normalize = (value: string) => value.replace(/\r\n?/g, '\n')
  const matches = (value: string, expected: string) => normalize(value) === normalize(expected)
  const pause = () => new Promise<void>(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))))
  const waitFor = async <T>(read: () => T | undefined | null | false, description: string): Promise<T> => {
    while (true) {
      const value = read()
      if (value !== undefined && value !== null && value !== false) return value
      if (Date.now() >= deadline) throw new Error(`${description}等待超时，请在打开的页面检查登录状态或编辑器`)
      await pause()
    }
  }
  const protectExisting = (value: string, expected: string, field: string) => {
    if (value.trim() && !matches(value, expected)) {
      throw new Error(`编辑器已有${field}，为避免覆盖已停止，请在空白编辑器中重试`)
    }
  }
  const findTitle = () => {
    const selectors = request.platform === 'huaweicloud'
      ? ['#blogTitle', 'input[placeholder*="标题"]']
      : ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]']
    for (const selector of selectors) {
      const input = document.querySelector<TextInput>(selector)
      if (input && !input.disabled && !input.readOnly) return input
    }
    return undefined
  }
  const setInput = (input: TextInput, value: string) => {
    const prototype = input.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setter) throw new Error('无法访问编辑器输入接口')
    input.focus()
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const modal = () => (window as unknown as { tinymceModal?: HuaweiModal }).tinymceModal
  const readHuawei = (editor: HuaweiEditor): string | undefined => {
    const value = editor.getContent?.({ format: 'text' })
    return typeof value === 'string' ? value : undefined
  }

  try {
    const hosts: Record<PageEditorPlatform, string> = {
      tencentcloud: 'cloud.tencent.com',
      aliyun: 'developer.aliyun.com',
      huaweicloud: 'bbs.huaweicloud.com',
    }
    if (location.hostname !== hosts[request.platform]) {
      throw new Error('投稿页面已跳转，请先登录目标平台再重试')
    }
    if (!request.title.trim() || !request.markdown.trim()) throw new Error('文章标题和正文不能为空')
    const title = await waitFor(findTitle, '标题输入框')
    protectExisting(title.value, request.title, '标题')

    if (request.platform === 'aliyun') {
      const body = await waitFor(() => {
        const isBody = (input: HTMLTextAreaElement) => input !== title && !input.disabled && !input.readOnly &&
          !/title|comment|feedback|reply|search|标题|反馈|评论/.test(`${input.name} ${input.id} ${input.placeholder}`.toLowerCase())
        const preferred = Array.from(document.querySelectorAll<HTMLTextAreaElement>(
          'textarea[class*="editor"], .markdown-editor textarea, .editor textarea'
        )).find(isBody)
        if (preferred) return preferred
        const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).filter(isBody)
        return candidates.length === 1 ? candidates[0] : undefined
      }, 'Markdown 编辑器')
      protectExisting(body.value, request.markdown, '正文')
      protectExisting(title.value, request.title, '标题')
      setInput(title, request.title)
      setInput(body, request.markdown)
      await pause()
      if (!matches(title.value, request.title) || !matches(body.value, request.markdown)) {
        throw new Error('编辑器内容回读不一致，请检查标题长度限制和正文')
      }
    } else if (request.platform === 'tencentcloud') {
      let switched = false
      const editor = await waitFor(() => {
        const node = document.querySelector('.CodeMirror') as (Element & { CodeMirror?: CodeMirror }) | null
        if (node?.CodeMirror && typeof node.CodeMirror.getValue === 'function' &&
          typeof node.CodeMirror.setValue === 'function') return node.CodeMirror
        // Follow EditorView.findFromDOM from @codemirror/view. CM6 keeps its
        // model on the content DOM (cmView in 6.38, cmTile in newer versions).
        // Reading visible text is insufficient because CM6 virtualizes lines.
        for (const content of document.querySelectorAll<CodeMirror6Content>('.cm-content[contenteditable="true"]')) {
          const view = content.cmView?.rootView?.view || content.cmTile?.root?.view
          if (view?.contentDOM !== content || view.state?.readOnly ||
            typeof view.state?.doc?.toString !== 'function' ||
            !Number.isInteger(view.state.doc.length) || typeof view.dispatch !== 'function') continue
          return {
            getValue: () => view.state.doc.toString(),
            setValue: (value: string) => {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
            },
          } satisfies CodeMirror
        }
        if (!switched) {
          const button = Array.from(document.querySelectorAll<HTMLElement>('.header-btn'))
            .find(item => /切换/.test(item.textContent || '') && /\bMD\b|Markdown/i.test(item.textContent || ''))
          if (button) {
            // A restored draft title is checked again before switching editor modes.
            protectExisting(title.value, request.title, '标题')
            const richBody = document.querySelector('[contenteditable="true"], .ql-editor')
            if (richBody && (richBody.textContent?.trim() || richBody.querySelector('img, video, iframe'))) {
              throw new Error('编辑器已有正文，为避免覆盖已停止，请在空白编辑器中重试')
            }
            button.click()
            switched = true
          }
        }
        return undefined
      }, 'CodeMirror 编辑器')
      protectExisting(editor.getValue(), request.markdown, '正文')
      protectExisting(title.value, request.title, '标题')
      setInput(title, request.title)
      editor.setValue(request.markdown)
      await pause()
      if (!matches(title.value, request.title) || !matches(editor.getValue(), request.markdown)) {
        throw new Error('编辑器内容回读不一致，请检查标题长度限制和正文')
      }
    } else {
      let switched = false
      const editor = await waitFor(() => {
        const current = modal()
        if (current?.currentEditorType === 'markdown' && current.currentEditor?.setContent) return current.currentEditor
        if (!switched) {
          if (!current?.currentEditor) return undefined
          const previous = current.currentEditor.getContent?.()
          if (typeof previous !== 'string') return undefined
          // TinyMCE's empty document is HTML, even when the user has typed nothing.
          // Read raw HTML here: text-only reads would lose image-only drafts.
          if (previous.replace(/<(?:p|div)(?:\s[^>]*)?>|<\/(?:p|div)>|<br\b[^>]*>|&nbsp;|\u00a0|\s/gi, '')) {
            throw new Error('编辑器已有正文，为避免覆盖已停止，请在空白编辑器中重试')
          }
          const button = Array.from(document.querySelectorAll<HTMLElement>('button, a, span, [role="button"]'))
            .find(item => item.textContent?.trim() === 'Markdown格式编辑')
          if (button) {
            protectExisting(title.value, request.title, '标题')
            button.click()
            switched = true
          }
        } else {
          // Only confirm a dialog which explicitly describes switching editors.
          const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], .el-message-box, .el-dialog, .ant-modal, .modal, .dialog'))
            .find(item => /Markdown|编辑器|格式/.test(item.textContent || ''))
          const confirm = dialog && Array.from(dialog.querySelectorAll<HTMLElement>('button, [role="button"]'))
            .find(item => /^(确定|确认|切换)$/.test(item.textContent?.trim() || ''))
          confirm?.click()
        }
        return undefined
      }, '华为云 Markdown 编辑器')
      const existing = readHuawei(editor)
      if (existing === undefined) throw new Error('无法读取华为云现有正文，为避免覆盖请手动检查编辑器')
      protectExisting(existing, request.markdown, '正文')
      const iframe = editor.editor_id ? document.getElementById(editor.editor_id) as HTMLIFrameElement | null : null
      let confirmed = false
      const expectedOrigin = iframe?.src && iframe.src !== 'about:blank'
        ? new URL(iframe.src, location.href).origin
        : location.origin
      const onMessage = (event: MessageEvent) => {
        if (!iframe?.contentWindow || event.source !== iframe.contentWindow || event.origin !== expectedOrigin) return
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          if (!data || typeof data !== 'object') return
          if (data.mdEventAction === 'setMdDataSucc') confirmed = true
          if (data.mdEventAction === 'mdContent') {
            const content = data.data ?? data.content
            if (typeof content === 'string') {
              let decoded = content
              try { decoded = decodeURIComponent(content) } catch { /* The editor may return plain Markdown. */ }
              if (matches(decoded, request.markdown)) confirmed = true
            }
          }
        } catch { /* Ignore unrelated page messages. */ }
      }
      window.addEventListener('message', onMessage)
      try {
        protectExisting(title.value, request.title, '标题')
        setInput(title, request.title)
        await editor.setContent(request.markdown)
        await waitFor(() => {
          const value = readHuawei(editor)
          return typeof value === 'string' ? matches(value, request.markdown) : confirmed
        }, '华为云正文确认')
        if (!matches(title.value, request.title)) throw new Error('标题回读不一致，请检查平台标题长度限制')
      } finally {
        window.removeEventListener('message', onMessage)
      }
    }

    return { success: true, url: location.href, message: '标题和正文已填入编辑器，请检查图片并手动保存草稿' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '编辑器填充失败', url: location.href }
  }
}
