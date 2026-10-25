import { describe, expect, it, vi } from 'vitest'
import { HuaweiCloudAdapter } from '../platforms/huaweicloud'
import type { RuntimeInterface } from '../../runtime/interface'

const profileUrl = 'https://devdata.huaweicloud.com/rest/developer/fwdu/rest/developer/user/hdcommunityservice/v1/member/get-personal-info'
const bootstrapUrl = 'https://devdata.huaweicloud.com/api/get-ainfo'
const profile = { memName: 'member', memAlias: '测试用户', memId: 9 }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const expired = (status = 400) => json({ error_code: 'HD.92010003', error_msg: 'token not found' }, status)
const login = () => new Response('checklogin({"flag":1,"username":"官网用户"});')
const bootstrap = () => new Response('', { headers: { csrf: 'test-csrf' } })

async function setup(responses: Response[]) {
  const fetch = vi.fn()
  for (const response of responses) fetch.mockResolvedValueOnce(response)
  const adapter = new HuaweiCloudAdapter()
  await adapter.init({ fetch } as unknown as RuntimeInterface)
  return { adapter, fetch }
}

describe('Huawei community authentication recovery', () => {
  it('keeps an authenticated profile on the single-request fast path', async () => {
    const { adapter, fetch } = await setup([json(profile)])
    expect(await adapter.checkAuth()).toMatchObject({ isAuthenticated: true, username: '测试用户', userId: '9' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([200, 400, 401])('recovers an explicit token error returned with HTTP %i', async status => {
    const { adapter, fetch } = await setup([expired(status), login(), bootstrap(), json(profile)])
    const result = await adapter.checkAuth()
    expect(result).toMatchObject({ isAuthenticated: true, username: '测试用户' })
    expect(JSON.stringify(result)).not.toContain('test-csrf')
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch).toHaveBeenNthCalledWith(1, profileUrl, {
      credentials: 'include', headers: { Accept: 'application/json' },
    })
    expect(fetch).toHaveBeenNthCalledWith(2,
      expect.stringMatching(/^https:\/\/devdata\.huaweicloud\.com\/index\/islogin\?callback=checklogin&t=\d+$/),
      { credentials: 'include', cache: 'no-store' }
    )
    expect(fetch).toHaveBeenNthCalledWith(3, bootstrapUrl, { credentials: 'include', cache: 'no-store' })
    expect(fetch).toHaveBeenNthCalledWith(4, profileUrl, {
      credentials: 'include', headers: { Accept: 'application/json', csrf: 'test-csrf' },
    })
  })

  it('awaits both initialization requests before retrying the profile', async () => {
    const { adapter, fetch } = await setup([expired()])
    let resolveLogin!: (value: Response) => void
    let resolveBootstrap!: (value: Response) => void
    fetch.mockImplementationOnce(() => new Promise(resolve => { resolveLogin = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveBootstrap = resolve }))
      .mockResolvedValueOnce(json(profile))
    let settled = false
    const pending = adapter.checkAuth().then(result => { settled = true; return result })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(settled).toBe(false)
    resolveLogin(login())
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(settled).toBe(false)
    resolveBootstrap(bootstrap())
    expect((await pending).isAuthenticated).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it.each([
    {},
    { memAlias: '昵称不能证明已登录' },
    { error_code: 'HD.92010004', error_msg: 'token not found' },
    { error_msg: 'token not found' },
    { error_code: 'HD.92010004', memName: '过期资料' },
  ])('does not initialize a session for another unauthenticated response: %j', async payload => {
    const { adapter, fetch } = await setup([json(payload)])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not trust JSONP login identity when the community profile is still unauthenticated', async () => {
    const { adapter, fetch } = await setup([expired(), login(), bootstrap(), json({ memAlias: '缓存昵称' })])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('does not repeat recovery when the retried profile still lacks a token', async () => {
    const { adapter, fetch } = await setup([expired(), login(), bootstrap(), expired()])
    expect(await adapter.checkAuth()).toMatchObject({ isAuthenticated: false, error: expect.stringContaining('社区会话已过期') })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('stops when the login initialization request fails', async () => {
    const { adapter, fetch } = await setup([expired(), new Response('', { status: 503 })])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    new Response(''),
    new Response('', { headers: { csrf: ' ' } }),
    new Response('', { status: 503, headers: { csrf: 'test-csrf' } }),
  ])('stops when get-ainfo does not provide a usable csrf response', async response => {
    const { adapter, fetch } = await setup([expired(), login(), response])
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([0, 1, 2, 3])('rejects a network failure at request %i without further requests', async requestIndex => {
    const responses = [expired(), login(), bootstrap(), json(profile)]
    const { adapter, fetch } = await setup(responses.slice(0, requestIndex))
    fetch.mockRejectedValueOnce(new Error('network unavailable'))
    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(requestIndex + 1)
  })

  it('rejects malformed and unrelated HTTP failures without session initialization', async () => {
    for (const response of [new Response('<html>登录</html>'), json({}, 500)]) {
      const { adapter, fetch } = await setup([response])
      expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })
})
