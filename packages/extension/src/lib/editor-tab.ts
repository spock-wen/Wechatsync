/** Tab IDs can be reused after a browser restart; verify the document before focusing it. */
export async function focusEditorTab(result: { tabId?: number; editorUrl?: string }): Promise<boolean> {
  if (result.tabId === undefined || !result.editorUrl) return false
  try {
    const tab = await chrome.tabs.get(result.tabId)
    if (!tab.url || new URL(tab.url).href !== new URL(result.editorUrl).href) return false
    await chrome.tabs.update(result.tabId, { active: true })
    return true
  } catch {
    return false
  }
}
