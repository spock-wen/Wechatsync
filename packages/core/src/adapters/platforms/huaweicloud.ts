import { PageAdapter } from '../page-adapter'
import type { AuthResult, PlatformMeta } from '../../types'

interface HuaweiCloudUserResponse {
  memName?: string
  memAlias?: string
  memPhoto?: string
  memId?: string | number
  error_code?: string
}

const PERSONAL_INFO_URL = 'https://devdata.huaweicloud.com/rest/developer/fwdu/rest/developer/user/hdcommunityservice/v1/member/get-personal-info'
const SESSION_EXPIRED_ERROR = '华为云社区会话已过期，请打开华为云开发者博客后重试'

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
      let response = await this.runtime.fetch(
        PERSONAL_INFO_URL,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      )
      let data = await response.json().catch(() => null) as HuaweiCloudUserResponse | null

      if (data?.error_code === 'HD.92010003') {
        // 官方页面先检查社区会话，再从 get-ainfo 响应头取得 csrf 注入 REST 请求。
        const login = await this.runtime.fetch(
          `https://devdata.huaweicloud.com/index/islogin?callback=checklogin&t=${Date.now()}`,
          { credentials: 'include', cache: 'no-store' }
        )
        if (!login.ok) return { isAuthenticated: false, error: SESSION_EXPIRED_ERROR }

        const bootstrap = await this.runtime.fetch('https://devdata.huaweicloud.com/api/get-ainfo', {
          credentials: 'include', cache: 'no-store',
        })
        const csrf = bootstrap.headers.get('csrf')?.trim()
        if (!bootstrap.ok || !csrf) return { isAuthenticated: false, error: SESSION_EXPIRED_ERROR }

        response = await this.runtime.fetch(PERSONAL_INFO_URL, {
          credentials: 'include', headers: { Accept: 'application/json', csrf },
        })
        data = await response.json().catch(() => null) as HuaweiCloudUserResponse | null
        if (data?.error_code === 'HD.92010003') {
          return { isAuthenticated: false, error: SESSION_EXPIRED_ERROR }
        }
      }

      if (!response.ok) {
        return { isAuthenticated: false, error: `华为云登录状态检查失败（HTTP ${response.status}）` }
      }

      if (data?.error_code || typeof data?.memName !== 'string' || !data.memName.trim()) {
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
