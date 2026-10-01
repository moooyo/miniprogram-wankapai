import { api, ensureSession, setDemoRole } from '../../services/api';
import type { Session } from '../../../shared/contracts';

Page({
  disposed: false,
  data: {
    loading: true,
    error: '',
    countsLoading: false,
    countsReady: false,
    countsError: '',
    session: null as Session | null,
    userDisplay: '',
    pendingCount: 0,
    returnedCount: 0,
    changingRole: false,
  },
  loadVersion: 0,
  onShow() { void this.load(); },
  onUnload() { this.disposed = true; this.loadVersion++; },
  async load() {
    if (this.disposed) return;
    const version = ++this.loadVersion;
    this.setData({ loading: true, error: '', session: null, userDisplay: '', countsLoading: false, countsReady: false, countsError: '', pendingCount: 0, returnedCount: 0 });
    try {
      const session = await ensureSession();
      if (version !== this.loadVersion) return;
      this.setData({ session, userDisplay: session.demo ? '演示用户' : `用户 ${session.userId.slice(-4)}`, loading: false, countsLoading: true });
    } catch {
      if (version === this.loadVersion) this.setData({ loading: false, session: null, error: '账号信息暂时无法确认，请重试。常用功能仍可从下方进入。' });
      return;
    }
    try {
      const [pending, returned] = await Promise.all([
        api.query('submissions.list', { status: 'pending', limit: 1 }),
        api.query('submissions.list', { status: 'returned', limit: 1 }),
      ]);
      if (version !== this.loadVersion) return;
      this.setData({
        countsReady: true,
        pendingCount: pending.items.length,
        returnedCount: returned.items.length,
      });
    } catch {
      if (version === this.loadVersion) this.setData({ countsReady: false, pendingCount: 0, returnedCount: 0, countsError: '投稿状态暂时无法读取，请重试。你仍可进入“我的投稿”查看审核结果。' });
    } finally { if (version === this.loadVersion) this.setData({ countsLoading: false }); }
  },
  openSubmissions() { wx.navigateTo({ url: '/pages/submissions/index' }); },
  openHistory() { wx.navigateTo({ url: '/pages/history/index' }); },
  openSubmission() { wx.navigateTo({ url: '/pages/submission-lead/index' }); },
  openPreferences() { wx.navigateTo({ url: '/pages/preferences/index' }); },
  openEntitlements() { wx.navigateTo({ url: '/pages/entitlements/index' }); },
  openLounges() { wx.navigateTo({ url: '/pages/lounges/index' }); },
  openReview() {
    if (this.data.session?.isModerator) wx.navigateTo({ url: '/pages/review/index' });
  },
  showPrivacy() {
    wx.showModal({
      title: '你的数据如何使用',
      content: '卡包、参与进度、收益与还款记录仅供你查看。活动投稿在审核前仅投稿人和运营可见；审核通过后只公开活动规则与参与入口，不公开你的个人记录。请勿上传完整卡号、账单账号或身份证照片。',
      showCancel: false,
      confirmText: '知道了',
    });
  },
  onDemoRole(event: { currentTarget: { dataset: { value: number | string } } }) {
    void this.changeDemoRole({ detail: { value: String(event.currentTarget.dataset.value) } });
  },
  async changeDemoRole(event: { detail: { value: string } }) {
    if (!this.data.session?.demo || this.data.changingRole) return;
    const version = this.loadVersion;
    this.setData({ changingRole: true });
    try {
      await setDemoRole(Number(event.detail.value) === 1 ? 'moderator' : 'user');
      if (version !== this.loadVersion) return;
      await this.load();
    } catch (error) {
      if (!this.disposed && version === this.loadVersion) this.setData({ error: error instanceof Error ? error.message : '角色切换失败，请重试。' });
    } finally { if (!this.disposed) this.setData({ changingRole: false }); }
  },
});
