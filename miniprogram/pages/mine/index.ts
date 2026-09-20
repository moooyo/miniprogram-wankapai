import { api, ensureSession, setDemoRole } from '../../services/api';
import type { Session } from '../../../shared/contracts';

Page({
  data: {
    loading: true,
    error: '',
    session: null as Session | null,
    pendingCount: 0,
    returnedCount: 0,
    changingRole: false,
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await ensureSession();
      const submissions = await api.query('submissions.list', { limit: 50 });
      this.setData({
        session,
        pendingCount: submissions.items.filter(item => item.status === 'pending').length,
        returnedCount: submissions.items.filter(item => item.status === 'returned').length,
      });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : '暂时无法读取，请重试。' });
    } finally { this.setData({ loading: false }); }
  },
  openSubmissions() { wx.navigateTo({ url: '/pages/submissions/index' }); },
  openSubmission() { wx.navigateTo({ url: '/pages/submission-edit/index' }); },
  openPreferences() { wx.navigateTo({ url: '/pages/preferences/index' }); },
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
  async changeDemoRole(event: { detail: { value: string } }) {
    if (!this.data.session?.demo || this.data.changingRole) return;
    this.setData({ changingRole: true });
    try {
      await setDemoRole(Number(event.detail.value) === 1 ? 'moderator' : 'user');
      await this.load();
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : '角色切换失败，请重试。' });
    } finally { this.setData({ changingRole: false }); }
  },
});
