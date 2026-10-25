import { PageAdapter } from '../page-adapter'
import type { AuthResult, PlatformMeta } from '../../types'

interface AliyunUserResponse {
  success?: boolean
  data?: {
    nickname?: string
    avatar?: string
    userId?: string | number
  }
}

export class AliyunAdapter extends PageAdapter {
  readonly meta: PlatformMeta = {
    id: 'aliyun',
    name: '阿里云开发者社区',
    icon: 'https://developer.aliyun.com/favicon.ico',
    homepage: 'https://developer.aliyun.com/',
    capabilities: ['article'],
    syncMode: 'editor',
  }

  protected readonly editorPlatform = 'aliyun' as const
  protected readonly editorUrl = 'https://developer.aliyun.com/article/new#/'

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        'https://developer.aliyun.com/developer/api/my/user/getUser',
        { credentials: 'include', headers: { Accept: 'application/json' } }
      )
      if (!response.ok) {
        return { isAuthenticated: false, error: `阿里云登录状态检查失败（HTTP ${response.status}）` }
      }

      const data = await response.json() as AliyunUserResponse
      const username = data.data?.nickname
      if (data.success !== true || typeof username !== 'string' || !username.trim()) {
        return { isAuthenticated: false, error: '请先登录阿里云开发者社区' }
      }

      return {
        isAuthenticated: true,
        username,
        ...(data.data?.userId != null ? { userId: String(data.data.userId) } : {}),
        ...(typeof data.data?.avatar === 'string' ? { avatar: data.data.avatar } : {}),
      }
    } catch {
      return { isAuthenticated: false, error: '无法确认阿里云登录状态，请登录后重试' }
    }
  }
}
