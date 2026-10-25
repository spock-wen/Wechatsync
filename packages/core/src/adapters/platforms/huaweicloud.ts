import { PageAdapter } from '../page-adapter'
import type { AuthResult, PlatformMeta } from '../../types'

interface HuaweiCloudUserResponse {
  memName?: string
  memAlias?: string
  memPhoto?: string
  memId?: string | number
}

export class HuaweiCloudAdapter extends PageAdapter {
  readonly meta: PlatformMeta = {
    id: 'huaweicloud',
    name: '华为云开发者博客',
    icon: 'https://www.huaweicloud.com/favicon.ico',
    homepage: 'https://bbs.huaweicloud.com/',
    capabilities: ['article'],
    syncMode: 'editor',
  }

  protected readonly editorPlatform = 'huaweicloud' as const
  protected readonly editorUrl = 'https://bbs.huaweicloud.com/blogs/article'

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        'https://devdata.huaweicloud.com/rest/developer/fwdu/rest/developer/user/hdcommunityservice/v1/member/get-personal-info',
        { credentials: 'include', headers: { Accept: 'application/json' } }
      )
      if (!response.ok) {
        return { isAuthenticated: false, error: `华为云登录状态检查失败（HTTP ${response.status}）` }
      }

      const data = await response.json() as HuaweiCloudUserResponse
      if (typeof data.memName !== 'string' || !data.memName.trim()) {
        return { isAuthenticated: false, error: '请先登录华为云开发者博客' }
      }

      return {
        isAuthenticated: true,
        username: typeof data.memAlias === 'string' && data.memAlias.trim() ? data.memAlias : data.memName,
        ...(data.memId != null ? { userId: String(data.memId) } : {}),
        ...(typeof data.memPhoto === 'string' ? { avatar: data.memPhoto } : {}),
      }
    } catch {
      return { isAuthenticated: false, error: '无法确认华为云登录状态，请登录后重试' }
    }
  }
}
