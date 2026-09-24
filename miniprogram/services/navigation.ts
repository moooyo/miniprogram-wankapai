export function navigateBackOr(fallbackUrl: string, tab = false): void {
  const fallback = () => {
    if (tab) wx.switchTab({ url: fallbackUrl });
    else wx.redirectTo({ url: fallbackUrl });
  };
  if (typeof getCurrentPages === 'function') {
    if (getCurrentPages().length <= 1) fallback();
    else wx.navigateBack();
    return;
  }
  wx.navigateBack({ fail: fallback });
}

export function backToActivity(activityId = '', participationId = ''): void {
  if (!activityId) { navigateBackOr('/pages/todo/index', true); return; }
  const record = participationId ? `&participationId=${encodeURIComponent(participationId)}` : '';
  navigateBackOr(`/pages/detail/index?id=${encodeURIComponent(activityId)}${record}`);
}
