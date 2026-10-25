import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { focusEditorTab } from '@/lib/editor-tab'
import type { SyncResult } from './types'

export function EditorLink({ result }: { result: SyncResult }) {
  const [notice, setNotice] = useState('')
  if (!result.editorUrl) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <a
        href={result.editorUrl}
        className="text-xs hover:underline inline-flex items-center gap-1 flex-shrink-0"
        title="切换到已填入内容的投稿标签页；请保留该标签页直到保存完成"
        onClick={async event => {
          event.preventDefault()
          event.stopPropagation()
          const focused = await focusEditorTab(result)
          setNotice(focused ? '' : '原编辑器已关闭或页面已变化，请重新同步正文')
        }}
      >
        打开编辑器 <ExternalLink className="w-3 h-3" />
      </a>
      {notice && <span className="text-xs text-amber-700 dark:text-amber-400" role="status">{notice}</span>}
    </span>
  )
}
