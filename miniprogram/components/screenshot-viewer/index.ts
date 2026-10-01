import { showError } from '../../services/format';
import { fittedImageRegions } from '../../services/image-regions';
type Shot = { id: string; url: string; label?: string; uploader?: string; uploadedOn?: string; recognized?: boolean; attempted?: boolean; regions?: { field: string; label: string; x: number; y: number; width: number; height: number }[] };
const activeViewers = new WeakSet<object>();
Component({
  properties: { show: { type: Boolean, value: false }, items: { type: Array, value: [] as Shot[] }, index: { type: Number, value: 0 }, context: { type: String, value: 'activity' } },
  data: { activeIndex: 0, statusHeight: 54, shot: null as Shot | null, regions: [] as object[], saving: false, note: '', imageRevision:0 },
  observers: { 'show, items, index, context'() { const items = this.data.items as Shot[]; this.syncShot(Math.min(Math.max(0, this.data.index), Math.max(0, items.length - 1))); if (this.data.show && !activeViewers.has(this)) { activeViewers.add(this); wx.hideTabBar({ animation:false, fail() {} }); } else if (!this.data.show && activeViewers.has(this)) { activeViewers.delete(this); this.restoreTab(); } } },
  lifetimes: { attached() { const info = wx.getWindowInfo(); this.setData({ statusHeight: info.statusBarHeight || 20 }); }, detached() { if(activeViewers.has(this)) { activeViewers.delete(this); this.restoreTab(); } } },
  methods: {
    syncShot(index: number) {
      const shot = (this.data.items as Shot[])[index] || null;
      const note = this.data.context === 'review' ? '请核对截图中的活动名称、时间与规则，再决定是否发布。' : this.data.context === 'form' ? shot?.recognized ? '蓝框为识别位置，相关内容已填入表单。' : shot?.attempted ? '未识别到活动信息，建议删除后重新上传。' : '尚未识别，返回后点击「识别截图并填写」。' : '截图由用户上传，仅供参考，请以银行 App 内公布的规则为准。';
      const revision = this.data.imageRevision + 1;
      this.setData({ activeIndex:index, shot, regions:[], note, imageRevision:revision });
      if (this.data.show && shot?.url && shot.regions?.length) {
        wx.getImageInfo({ src:shot.url, success:info => {
          if (!this.data.show || this.data.imageRevision !== revision || this.data.shot?.id !== shot.id) return;
          const window = wx.getWindowInfo();
          const width = Math.min(300, Math.max(1,window.windowWidth - 88));
          this.setData({ regions:fittedImageRegions(shot.regions || [],info.width,info.height,width,width * 4 / 3) });
        }, fail() {} });
      }
    },
    restoreTab() { const pages = getCurrentPages(); const route = pages[pages.length - 1]?.route; if (['pages/todo/index','pages/activities/index','pages/wallet/index','pages/mine/index'].includes(route || '')) wx.showTabBar({ animation: false, fail() {} }); },
    close() { this.triggerEvent('close'); }, stop() {},
    previous() { if (this.data.activeIndex > 0) this.syncShot(this.data.activeIndex - 1); },
    next() { if (this.data.activeIndex < this.data.items.length - 1) this.syncShot(this.data.activeIndex + 1); },
    remove() { if (this.data.shot) this.triggerEvent('delete', { id: this.data.shot.id }); },
    copy() { if (this.data.shot?.url) wx.setClipboardData({ data: this.data.shot.url }); },
    feedback() { wx.showModal({ title:'反馈截图问题', content:'如截图信息不完整或与银行规则不符，请在活动线索中提供截图和说明，由运营核对。', confirmText:'提交线索', success: result => { if (result.confirm) { this.triggerEvent('close'); wx.navigateTo({ url:'/pages/submission-lead/index' }); } } }); },
    async save() {
      if (this.data.saving || !this.data.shot?.url) return; this.setData({ saving:true });
      try { let filePath = this.data.shot.url; if (/^https:\/\//.test(filePath)) { const result = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve,reject) => wx.downloadFile({ url:filePath, success:resolve, fail:reject })); if (result.statusCode !== 200) throw new Error('图片下载失败，请重试。'); filePath=result.tempFilePath; } await wx.saveImageToPhotosAlbum({ filePath }); wx.showToast({ title:'图片已保存', icon:'success' }); }
      catch(error) { showError(error); } finally { this.setData({ saving:false }); }
    },
  },
});
