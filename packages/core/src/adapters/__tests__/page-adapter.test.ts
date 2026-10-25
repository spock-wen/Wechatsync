import { describe, expect, it, vi } from 'vitest'
import { AliyunAdapter } from '../platforms/aliyun'
import { TencentCloudAdapter } from '../platforms/tencentcloud'
import { HuaweiCloudAdapter } from '../platforms/huaweicloud'
import type { RuntimeInterface } from '../../runtime/interface'

const article = { title: '云平台适配验证', markdown: '# 正文\n\n```ts\nconst value = 1\n```' }

function setupRuntime(response: Response = new Response(JSON.stringify({
  success: true,
  data: { nickname: '测试用户' },
}))) {
  const fetch = vi.fn().mockResolvedValue(response)
  const tabs = {
    create: vi.fn().mockResolvedValue({ id: 7 }),
    waitForLoad: vi.fn().mockResolvedValue(undefined),
    executeScript: vi.fn().mockResolvedValue({ success: true }),
  }
  const runtime = { fetch, tabs } as unknown as RuntimeInterface
  return { runtime, fetch, tabs }
}

describe('PageAdapter handoff', () => {
  it('waits for confirmed editor filling and leaves saving to the user', async () => {
    const { runtime, tabs } = setupRuntime()
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    const result = await adapter.publish(article)

    expect(tabs.create).toHaveBeenCalledWith('https://developer.aliyun.com/article/new#/', true)
    expect(tabs.waitForLoad).toHaveBeenCalledWith(7)
    expect(tabs.executeScript).toHaveBeenCalledWith(7, expect.any(Function), [{
      platform: 'aliyun', title: article.title, markdown: article.markdown, timeoutMs: 20000,
    }])
    expect(result).toMatchObject({
      platform: 'aliyun', success: false, outcome: 'editor_filled', tabId: 7,
      editorUrl: 'https://developer.aliyun.com/article/new#/',
    })
    expect(result.message).toContain('手动保存草稿')
    expect(result).not.toHaveProperty('draftOnly')
    expect(result).not.toHaveProperty('postId')
    expect(result).not.toHaveProperty('postUrl')
  })

  it('does not report completion before the injected driver settles', async () => {
    const { runtime, tabs } = setupRuntime()
    let resolveFill!: (value: { success: boolean }) => void
    tabs.executeScript.mockImplementation(() => new Promise(resolve => { resolveFill = resolve }))
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    let settled = false
    const pending = adapter.publish(article).then(result => { settled = true; return result })
    await vi.waitFor(() => expect(tabs.executeScript).toHaveBeenCalled())
    expect(settled).toBe(false)
    resolveFill({ success: true })
    expect((await pending).outcome).toBe('editor_filled')
  })

  it('returns a recovery editor link when the driver reports failure', async () => {
    const { runtime, tabs } = setupRuntime()
    tabs.executeScript.mockResolvedValue({ success: false, error: '未找到正文编辑器' })
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)

    expect(await adapter.publish(article)).toMatchObject({
      success: false, outcome: 'failed', error: '未找到正文编辑器', tabId: 7,
      editorUrl: 'https://developer.aliyun.com/article/new#/',
    })
  })

  it('rejects an empty injection result', async () => {
    const { runtime, tabs } = setupRuntime()
    tabs.executeScript.mockResolvedValue(undefined)
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect((await adapter.publish(article)).outcome).toBe('failed')
  })

  it('preserves the tab link when page loading fails', async () => {
    const { runtime, tabs } = setupRuntime()
    tabs.waitForLoad.mockRejectedValue(new Error('Tab load timeout'))
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect(await adapter.publish(article)).toMatchObject({
      success: false, outcome: 'failed', tabId: 7, error: 'Tab load timeout',
    })
    expect(tabs.executeScript).not.toHaveBeenCalled()
  })

  it('does not open a tab for expired credentials', async () => {
    const { runtime, tabs } = setupRuntime(new Response('{}', { status: 401 }))
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect((await adapter.publish(article)).outcome).toBe('failed')
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('fails explicitly when the runtime cannot open pages', async () => {
    const { runtime } = setupRuntime()
    delete runtime.tabs
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect((await adapter.publish(article)).error).toContain('不支持打开浏览器编辑器')
  })

  it('rejects content that cannot be handed off as Markdown', async () => {
    const { runtime, tabs } = setupRuntime()
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect((await adapter.publish({ ...article, markdown: ' ' })).outcome).toBe('failed')
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('warns that remote images have not been transferred', async () => {
    const { runtime } = setupRuntime()
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    const result = await adapter.publish({ ...article, markdown: '![示例](https://images.example/test.png)' })
    expect(result.warnings?.[0]).toContain('尚未确认转存')
    expect(result.outcome).toBe('editor_filled')
  })

  it('does not accept a driver success from a redirected site', async () => {
    const { runtime, tabs } = setupRuntime()
    tabs.executeScript.mockResolvedValue({ success: true, url: 'https://account.aliyun.com/login' })
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    const result = await adapter.publish(article)
    expect(result.outcome).toBe('failed')
    expect(result.editorUrl).toBe('https://developer.aliyun.com/article/new#/')
  })
})

describe('cloud platform authentication', () => {
  it('accepts the authenticated Aliyun profile response', async () => {
    const { runtime, fetch } = setupRuntime(new Response(JSON.stringify({
      success: true, data: { nickname: '阿里用户', userId: 42, avatar: 'https://images.example/avatar.png' },
    })))
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect(await adapter.checkAuth()).toMatchObject({ isAuthenticated: true, username: '阿里用户', userId: '42' })
    expect(fetch).toHaveBeenCalledWith(
      'https://developer.aliyun.com/developer/api/my/user/getUser', expect.objectContaining({ credentials: 'include' })
    )
  })

  it.each([
    { success: false, data: { nickname: '过期用户' } },
    { success: true, data: {} },
    { success: true, data: { nickname: '  ' } },
  ])('rejects an unauthenticated or incomplete Aliyun response: %j', async payload => {
    const { runtime } = setupRuntime(new Response(JSON.stringify(payload)))
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it('rejects a malformed authentication response', async () => {
    const { runtime } = setupRuntime(new Response('<html>登录</html>'))
    const adapter = new AliyunAdapter()
    await adapter.init(runtime)
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it('accepts a Huawei profile with an identified member', async () => {
    const { runtime } = setupRuntime(new Response(JSON.stringify({ memName: 'member', memAlias: '华为用户', memId: 9 })))
    const adapter = new HuaweiCloudAdapter()
    await adapter.init(runtime)
    expect(await adapter.checkAuth()).toMatchObject({ isAuthenticated: true, username: '华为用户', userId: '9' })
  })

  it('rejects a Huawei response without a member name', async () => {
    const { runtime } = setupRuntime(new Response(JSON.stringify({ memAlias: '缓存昵称' })))
    const adapter = new HuaweiCloudAdapter()
    await adapter.init(runtime)
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it('reads Tencent identity from nested current-user JSON and decodes escapes', async () => {
    const { runtime } = setupRuntime(new Response('<script>{"userInfo":{"profile":{"id":1},"nickname":"测试\\u7528户","uid":8,"avatarUrl":"https://images.example/avatar.png"}}</script>'))
    const adapter = new TencentCloudAdapter()
    await adapter.init(runtime)
    expect(await adapter.checkAuth()).toMatchObject({ isAuthenticated: true, username: '测试用户', userId: '8' })
  })

  it.each([
    '<div>创作中心 我的文章</div>',
    '<script>{"isLogin":false,"userInfo":{"nickname":"缓存用户"}}</script>',
    '<script>{"userInfo":{"nickname":""}}</script>',
  ])('does not infer Tencent login from public or stale data: %s', async html => {
    const { runtime } = setupRuntime(new Response(html))
    const adapter = new TencentCloudAdapter()
    await adapter.init(runtime)
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it('rejects Tencent redirects to the login page', async () => {
    const response = new Response('{"userInfo":{"nickname":"缓存用户"}}')
    Object.defineProperty(response, 'url', { value: 'https://cloud.tencent.com/login' })
    const { runtime } = setupRuntime(response)
    const adapter = new TencentCloudAdapter()
    await adapter.init(runtime)
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it('advertises assisted editing without draft or image-upload guarantees', () => {
    for (const Adapter of [TencentCloudAdapter, AliyunAdapter, HuaweiCloudAdapter]) {
      const adapter = new Adapter()
      expect(adapter.meta.syncMode).toBe('editor')
      expect(adapter.meta.capabilities).toEqual(['article'])
      expect(adapter.preprocessConfig.outputFormat).toBe('markdown')
    }
  })
})
