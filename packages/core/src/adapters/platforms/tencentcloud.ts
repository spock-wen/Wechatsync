import { PageAdapter } from '../page-adapter'
import type { AuthResult, PlatformMeta } from '../../types'

function findCurrentUser(html: string): Record<string, unknown> | undefined {
  const blocks = /"(?:userInfo|creatorInfo|currentUser)"\s*:\s*\{/g
  while (blocks.exec(html)) {
    const start = blocks.lastIndex - 1
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < html.length; index++) {
      const char = html[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        try {
          const user = JSON.parse(html.slice(start, index + 1)) as Record<string, unknown>
          if (typeof user.nickname === 'string' && user.nickname.trim()) return user
        } catch {
          // 跳过非 JSON 的片段，继续检查下一个当前用户数据块。
        }
        break
      }
    }
  }
  return undefined
}

export class TencentCloudAdapter extends PageAdapter {
  readonly meta: PlatformMeta = {
    id: 'tencentcloud',
    name: '腾讯云开发者社区',
    icon: 'https://cloudcache.tencent-cloud.com/qcloud/favicon.ico',
    homepage: 'https://cloud.tencent.com/developer',
    capabilities: ['article'],
    syncMode: 'editor',
  }

  protected readonly editorPlatform = 'tencentcloud' as const
  protected readonly editorUrl = 'https://cloud.tencent.com/developer/article/write-new'

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch('https://cloud.tencent.com/developer/creator', {
        credentials: 'include',
      })
      if (!response.ok) {
        return { isAuthenticated: false, error: `腾讯云登录状态检查失败（HTTP ${response.status}）` }
      }

      if (response.url) {
        const finalUrl = new URL(response.url)
        if (finalUrl.origin !== 'https://cloud.tencent.com' ||
          !/^\/developer\/creator(?:\/|$)/.test(finalUrl.pathname)) {
          return { isAuthenticated: false, error: '请先登录腾讯云开发者社区' }
        }
      }

      const html = await response.text()
      if (/"(?:isLogin|login)"\s*:\s*false/.test(html)) {
        return { isAuthenticated: false, error: '请先登录腾讯云开发者社区' }
      }

      // 只接受当前用户数据块中的昵称，不以 Cookie 或通用页面文案判断登录。
      const user = findCurrentUser(html)
      if (!user) {
        return { isAuthenticated: false, error: '无法确认腾讯云登录用户，请登录创作中心后重试' }
      }
      const avatar = user.avatarUrl || user.avatar
      const userId = user.userId ?? user.uid

      return {
        isAuthenticated: true,
        username: user.nickname as string,
        ...(typeof avatar === 'string' ? { avatar } : {}),
        ...(typeof userId === 'string' || typeof userId === 'number' ? { userId: String(userId) } : {}),
      }
    } catch {
      return { isAuthenticated: false, error: '无法确认腾讯云登录状态，请登录后重试' }
    }
  }
}
