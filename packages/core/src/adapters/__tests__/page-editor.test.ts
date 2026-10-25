import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'
import { describe, expect, it, vi } from 'vitest'
import { fillPageEditor, type PageEditorPlatform, type PageEditorResponse } from '../page-editor'

function environment(platform: PageEditorPlatform, body = '') {
  const dom = parseHTML(`<html><body>${body}</body></html>`)
  const listeners = new Set<(event: unknown) => void>()
  const hosts = { aliyun: 'developer.aliyun.com', tencentcloud: 'cloud.tencent.com', huaweicloud: 'bbs.huaweicloud.com' }
  const location = new URL(`https://${hosts[platform]}/editor`)
  const window = {
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => listeners.delete(listener)),
    tinymceModal: undefined as unknown,
  }
  const run = (timeoutMs = 250, markdown = '# Heading\n\nBody') => runInNewContext(`(${fillPageEditor.toString()})(request)`, {
    window,
    document: dom.document,
    location,
    Event: dom.window.Event,
    URL,
    setTimeout,
    request: { platform, title: 'A useful title', markdown, timeoutMs },
  }) as Promise<PageEditorResponse>
  const send = (data: unknown, source: unknown, origin: string) => {
    for (const listener of listeners) listener({ data, source, origin })
  }
  return { document: dom.document, window, location, run, listeners, send }
}

function codeMirror6Environment(binding: 'cmView' | 'cmTile', initial = '') {
  const env = environment('tencentcloud', '<textarea placeholder="标题"></textarea><textarea id="code"></textarea><div class="cm-editor"><div class="cm-scroller"><div class="cm-content cm-lineWrapping" contenteditable="true" role="textbox" data-language="markdown"><div class="cm-line"><br></div></div></div></div>')
  const contentDOM = env.document.querySelector<HTMLElement>('.cm-content')!
  let value = initial
  const dispatch = vi.fn(({ changes }: { changes: { from: number; to: number; insert: string } }) => {
    value = value.slice(0, changes.from) + changes.insert + value.slice(changes.to)
  })
  const view = {
    contentDOM,
    state: {
      readOnly: false,
      get doc() { return { length: value.length, toString: () => value } },
    },
    dispatch,
  }
  const attachment = binding === 'cmView' ? { rootView: { view } } : { root: { view } }
  Object.assign(contentDOM, { [binding]: attachment })
  return { ...env, contentDOM, view, dispatch, attachment }
}

describe('serialized page editor driver', () => {
  it('fills and reads back Aliyun inputs without invoking save or publish', async () => {
    const env = environment('aliyun', '<input placeholder="标题"><textarea class="editor"></textarea><button>发布</button>')
    const publish = vi.fn()
    env.document.querySelector('button')!.addEventListener('click', publish)
    const result = await env.run()
    expect(result.success).toBe(true)
    expect(env.document.querySelector('input')!.value).toBe('A useful title')
    expect(env.document.querySelector('textarea')!.value).toBe('# Heading\n\nBody')
    expect(publish).not.toHaveBeenCalled()
    expect(result.message).toContain('手动保存')
  })

  it('protects an existing body and leaves the title untouched', async () => {
    const env = environment('aliyun', '<input placeholder="标题"><textarea>Existing draft</textarea>')
    const result = await env.run()
    expect(result.success).toBe(false)
    expect(result.error).toContain('已有正文')
    expect(env.document.querySelector('input')!.value).toBe('')
    expect(env.document.querySelector('textarea')!.value).toBe('Existing draft')
  })

  it('fails when a controlled textarea rejects the supplied body', async () => {
    const env = environment('aliyun', '<input placeholder="标题"><textarea></textarea>')
    const textarea = env.document.querySelector('textarea')!
    textarea.addEventListener('input', () => { textarea.value = '' })
    const result = await env.run()
    expect(result.success).toBe(false)
    expect(result.error).toContain('回读不一致')
  })

  it('reports platform title truncation rather than claiming the fill succeeded', async () => {
    const env = environment('aliyun', '<input placeholder="标题"><textarea></textarea>')
    const title = env.document.querySelector('input')!
    title.addEventListener('input', () => { title.value = title.value.slice(0, 5) })
    expect((await env.run()).success).toBe(false)
  })

  it('waits for CodeMirror initialization and for asynchronous filling to finish', async () => {
    const env = environment('tencentcloud', '<textarea placeholder="标题"></textarea><div class="CodeMirror"></div>')
    let value = ''
    const setValue = vi.fn((text: string) => { value = text })
    setTimeout(() => {
      Object.assign(env.document.querySelector('.CodeMirror')!, { CodeMirror: { getValue: () => value, setValue } })
    }, 5)
    let settled = false
    const pending = env.run().then(result => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    const result = await pending
    expect(result.success).toBe(true)
    expect(setValue).toHaveBeenCalledWith('# Heading\n\nBody')
  })

  it('does not switch Tencent rich-text mode over an existing draft', async () => {
    const env = environment('tencentcloud', '<textarea placeholder="标题"></textarea><button class="header-btn">切换 MD 编辑器</button><div contenteditable="true">Restored draft</div>')
    const click = vi.fn()
    env.document.querySelector('button')!.addEventListener('click', click)
    expect((await env.run()).error).toContain('已有正文')
    expect(click).not.toHaveBeenCalled()
  })

  it('fills a large Tencent CM6 document through a model transaction, including off-screen lines', async () => {
    const env = codeMirror6Environment('cmView')
    const markdown = '# 大篇幅验证\n\n' + '中文、表格 | A | B | 与代码 `console.log(1)`\n'.repeat(1200)
    const result = await env.run(250, markdown)
    expect(result.success).toBe(true)
    expect(env.dispatch).toHaveBeenCalledWith({ changes: { from: 0, to: 0, insert: markdown } })
    expect(env.view.state.doc.toString()).toBe(markdown)
    // CM6 renders only its viewport. Success must come from the full model,
    // never from a hidden textarea or the visible content DOM.
    expect(env.contentDOM.textContent).toBe('')
    expect(env.document.querySelector<HTMLTextAreaElement>('#code')!.value).toBe('')
  })

  it('supports the newer CM6 cmTile DOM binding used by EditorView.findFromDOM', async () => {
    const env = codeMirror6Environment('cmTile')
    expect((await env.run()).success).toBe(true)
    expect(env.view.state.doc.toString()).toBe('# Heading\n\nBody')
  })

  it('protects a CM6 model draft even when no text is visible in the viewport', async () => {
    const env = codeMirror6Environment('cmView', '# User draft outside the viewport')
    const result = await env.run()
    expect(result.error).toContain('已有正文')
    expect(env.dispatch).not.toHaveBeenCalled()
    expect(env.document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('')
    expect(env.view.state.doc.toString()).toBe('# User draft outside the viewport')
  })

  it('waits for the CM6 model binding instead of treating an empty editor DOM as ready', async () => {
    const env = codeMirror6Environment('cmView')
    delete (env.contentDOM as HTMLElement & { cmView?: unknown }).cmView
    setTimeout(() => Object.assign(env.contentDOM, { cmView: env.attachment }), 5)
    let settled = false
    const pending = env.run().then(result => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect((await pending).success).toBe(true)
    expect(env.dispatch).toHaveBeenCalledOnce()
  })

  it('fails without changing a CM6 DOM when its model is unavailable or read-only', async () => {
    const env = codeMirror6Environment('cmView')
    delete (env.contentDOM as HTMLElement & { cmView?: unknown }).cmView
    expect((await env.run(5)).error).toContain('CodeMirror 编辑器等待超时')
    Object.assign(env.contentDOM, { cmView: env.attachment })
    env.view.state.readOnly = true
    expect((await env.run(5)).success).toBe(false)
    expect(env.dispatch).not.toHaveBeenCalled()
    expect(env.contentDOM.textContent).toBe('')
  })

  it('rejects a CM6 transaction whose model did not accept the supplied document', async () => {
    const env = codeMirror6Environment('cmView')
    env.dispatch.mockImplementation(() => {})
    expect((await env.run()).error).toContain('回读不一致')
    expect(env.view.state.doc.toString()).toBe('')
  })

  it('switches a blank Tencent editor to Markdown and verifies CodeMirror content', async () => {
    const env = environment('tencentcloud', '<textarea placeholder="标题"></textarea><button class="header-btn">切换 MD 编辑器</button><div class="CodeMirror"></div>')
    let value = ''
    env.document.querySelector('button')!.addEventListener('click', () => {
      Object.assign(env.document.querySelector('.CodeMirror')!, {
        CodeMirror: { getValue: () => value, setValue: (text: string) => { value = text } },
      })
    })
    expect((await env.run()).success).toBe(true)
    expect(value).toBe('# Heading\n\nBody')
  })

  it('does not overwrite a title typed while waiting for the editor', async () => {
    const env = environment('tencentcloud', '<textarea placeholder="标题"></textarea><div class="CodeMirror"></div>')
    const setValue = vi.fn()
    setTimeout(() => {
      env.document.querySelector('textarea')!.value = 'User started editing'
      Object.assign(env.document.querySelector('.CodeMirror')!, { CodeMirror: { getValue: () => '', setValue } })
    }, 5)
    expect((await env.run()).error).toContain('已有标题')
    expect(setValue).not.toHaveBeenCalled()
  })

  it('fails on editor timeout and on a login redirect', async () => {
    const env = environment('tencentcloud', '<textarea placeholder="标题"></textarea>')
    expect((await env.run(5)).error).toContain('等待超时')
    env.location.hostname = 'login.example.com'
    expect((await env.run(5)).error).toContain('先登录')
  })

  it('fills Huawei Markdown and confirms the body through the real editor API', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><button>保存草稿</button>')
    let value = ''
    const save = vi.fn()
    env.document.querySelector('button')!.addEventListener('click', save)
    env.window.tinymceModal = {
      currentEditorType: 'markdown',
      currentEditor: {
        getContent: () => value,
        setContent: async (text: string) => {
          await new Promise(resolve => setTimeout(resolve, 5))
          value = text
        },
      },
    }
    expect((await env.run()).success).toBe(true)
    expect(save).not.toHaveBeenCalled()
    expect(env.listeners.size).toBe(0)
  })

  it('accepts Huawei iframe acknowledgement only from its own frame and origin', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><iframe id="md-editor" src="https://editor.huaweicloud.com/frame"></iframe>')
    const frame = {}
    Object.defineProperty(env.document.querySelector('iframe'), 'contentWindow', { value: frame })
    let written = false
    env.window.tinymceModal = {
      currentEditorType: 'markdown',
      currentEditor: {
        editor_id: 'md-editor',
        getContent: () => written ? undefined : '',
        setContent: () => {
          written = true
          env.send({ mdEventAction: 'setMdDataSucc' }, {}, 'https://editor.huaweicloud.com')
          env.send({ mdEventAction: 'setMdDataSucc' }, frame, 'https://other.example.com')
          setTimeout(() => env.send({ mdEventAction: 'setMdDataSucc' }, frame, 'https://editor.huaweicloud.com'), 5)
        },
      },
    }
    expect((await env.run()).success).toBe(true)
    expect(env.listeners.size).toBe(0)
    expect(env.window.removeEventListener).toHaveBeenCalledOnce()
  })

  it('rejects spoofed iframe acknowledgements and cleans listeners on timeout', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><iframe id="md-editor" src="https://editor.huaweicloud.com/frame"></iframe>')
    const frame = {}
    Object.defineProperty(env.document.querySelector('iframe'), 'contentWindow', { value: frame })
    let written = false
    env.window.tinymceModal = {
      currentEditorType: 'markdown',
      currentEditor: {
        editor_id: 'md-editor',
        getContent: () => written ? undefined : '',
        setContent: () => {
          written = true
          env.send({ mdEventAction: 'setMdDataSucc' }, {}, 'https://editor.huaweicloud.com')
          env.send({ mdEventAction: 'setMdDataSucc' }, frame, 'https://wrong.example.com')
        },
      },
    }
    expect((await env.run(5)).error).toContain('正文确认等待超时')
    expect(env.listeners.size).toBe(0)
  })

  it('requires matching Huawei readback even when the frame sends an acknowledgement', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><iframe id="md-editor" src="https://editor.huaweicloud.com/frame"></iframe>')
    const frame = {}
    Object.defineProperty(env.document.querySelector('iframe'), 'contentWindow', { value: frame })
    let value = ''
    env.window.tinymceModal = {
      currentEditorType: 'markdown',
      currentEditor: {
        editor_id: 'md-editor',
        getContent: () => value,
        setContent: () => {
          value = 'Rejected body'
          env.send({ mdEventAction: 'setMdDataSucc' }, frame, 'https://editor.huaweicloud.com')
        },
      },
    }
    expect((await env.run(5)).success).toBe(false)
    expect(env.listeners.size).toBe(0)
  })

  it('protects Huawei rich-text drafts before a Markdown mode switch', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><button>Markdown格式编辑</button>')
    const click = vi.fn()
    env.document.querySelector('button')!.addEventListener('click', click)
    env.window.tinymceModal = {
      currentEditorType: 'tinymce',
      currentEditor: { getContent: () => '<p>Existing content</p>', setContent: vi.fn() },
    }
    expect((await env.run()).error).toContain('已有正文')
    expect(click).not.toHaveBeenCalled()
  })

  it('protects image-only Huawei drafts using HTML rather than the empty text read', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><button>Markdown格式编辑</button>')
    const click = vi.fn()
    env.document.querySelector('button')!.addEventListener('click', click)
    env.window.tinymceModal = {
      currentEditorType: 'tinymce',
      currentEditor: {
        getContent: (options?: { format?: string }) => options?.format === 'text' ? '' : '<p><img src="existing.png"></p>',
        setContent: vi.fn(),
      },
    }
    expect((await env.run()).error).toContain('已有正文')
    expect(click).not.toHaveBeenCalled()
  })

  it('confirms only the Huawei Markdown switch dialog, leaving unrelated confirm buttons alone', async () => {
    const env = environment('huaweicloud', '<input id="blogTitle"><button id="switch">Markdown格式编辑</button><button id="unrelated">确定</button><div role="dialog">切换Markdown编辑器<button id="confirm">确定</button></div>')
    let value = ''
    const unrelated = vi.fn()
    env.document.querySelector('#unrelated')!.addEventListener('click', unrelated)
    env.window.tinymceModal = {
      currentEditorType: 'tinymce',
      currentEditor: { getContent: () => '<p><br></p>', setContent: vi.fn() },
    }
    env.document.querySelector('#confirm')!.addEventListener('click', () => {
      env.window.tinymceModal = {
        currentEditorType: 'markdown',
        currentEditor: { getContent: () => value, setContent: (text: string) => { value = text } },
      }
    })
    expect((await env.run(500)).success).toBe(true)
    expect(unrelated).not.toHaveBeenCalled()
  })
})
