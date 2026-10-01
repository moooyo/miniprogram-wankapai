import settings from '../../runtime-config';
Component({
  properties: { title: { type: String, value: '' }, subtitle: { type: String, value: '' }, back: { type: Boolean, value: false }, customBack: { type: Boolean, value: false }, backDisabled:{type:Boolean,value:false} },
  data: { statusHeight: 54, demo: settings.mode === 'demo' },
  lifetimes: { attached() {
    const info = wx.getWindowInfo();
    const capsule = wx.getMenuButtonBoundingClientRect?.();
    this.setData({ statusHeight: capsule?.top ? capsule.top - Math.max(0, (44 - capsule.height) / 2) : info.statusBarHeight || 20 });
  } },
  methods: { goBack() {
    if (this.data.backDisabled) return;
    if (this.data.customBack) { this.triggerEvent('back'); return; }
    if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: '/pages/todo/index' });
  } },
});
