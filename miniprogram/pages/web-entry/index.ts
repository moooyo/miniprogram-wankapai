import settings from '../../runtime-config';
import { navigateBackOr } from '../../services/navigation';
import { resolveWebViewUrl } from '../../services/entrance';
import { validatePublicHttps } from '../../../domain/validation';

Page({
  data: { url: '', sourceUrl: '', error: '', canRetry: false, loading: false },
  onLoad(options: Record<string, string | undefined>) {
    let url = '';
    try {
      url = validatePublicHttps(decodeURIComponent(options.url || ''));
    } catch {
      this.setData({ error: '活动入口地址无效，请返回活动页核对规则或来源。' });
      return;
    }
    this.setData({ sourceUrl: url });
    const target = resolveWebViewUrl(url, settings);
    if (!target) {
      this.setData({ error: '此网页暂不支持在小程序内打开。可以复制地址，在浏览器中查看，或返回活动页按银行指引参与。' });
      return;
    }
    this.setData({ sourceUrl: target, canRetry: true });
    this.retry();
  },
  onUnload() { wx.hideNavigationBarLoading(); },
  retry() {
    if (!this.data.canRetry || this.data.loading) return;
    this.setData({ url: '', error: '', loading: true }, () => {
      wx.showNavigationBarLoading();
      this.setData({ url: this.data.sourceUrl });
    });
  },
  loaded() { this.setData({ loading: false }); wx.hideNavigationBarLoading(); },
  failed() {
    this.setData({ url: '', loading: false, error: '网页暂时无法打开。请检查网络后重试，也可以复制地址到浏览器查看。' });
    wx.hideNavigationBarLoading();
  },
  copyUrl() { if (this.data.sourceUrl) wx.setClipboardData({ data: this.data.sourceUrl }); },
  goBack() { navigateBackOr('/pages/activities/index', true); },
});
