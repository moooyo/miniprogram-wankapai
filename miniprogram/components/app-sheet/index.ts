import appConfig from '../../app.json';

const tabRoutes = new Set(appConfig.tabBar.list.map(item => item.pagePath));
const activeSheets = new Set<object>();
const resizeHandlers = new WeakMap<object, () => void>();
let tabBarHidden = false;
let restoringTabBar = false;
let tabBarRevision = 0;

function restoreTabBar() {
  if (activeSheets.size || !tabBarHidden || restoringTabBar) return;
  const pages = getCurrentPages();
  if (!tabRoutes.has(pages[pages.length - 1]?.route || '')) return;
  const revision = ++tabBarRevision;
  restoringTabBar = true;
  wx.showTabBar({
    animation: false,
    success: () => { if (revision === tabBarRevision) { tabBarHidden = false; restoringTabBar = false; } },
    fail: () => { if (revision === tabBarRevision) restoringTabBar = false; },
  });
}

function updateTabBar(owner: object, visible: boolean) {
  if (visible) {
    activeSheets.add(owner);
    const pages = getCurrentPages();
    if ((tabBarHidden && !restoringTabBar) || !tabRoutes.has(pages[pages.length - 1]?.route || '')) return;
    const revision = ++tabBarRevision;
    restoringTabBar = false;
    tabBarHidden = true;
    wx.hideTabBar({
      animation: false,
      success: () => wx.nextTick(() => { if (activeSheets.has(owner)) (owner as { measure?: () => void }).measure?.(); }),
      fail: () => { if (revision === tabBarRevision) tabBarHidden = false; },
    });
    return;
  }
  activeSheets.delete(owner);
  restoreTabBar();
}

Component({
  options: { multipleSlots: true },
  properties: { show: { type: Boolean, value: false }, title: { type: String, value: '' } },
  data: { bodyHeight: 200 },
  observers: {
    show(visible: boolean) {
      updateTabBar(this, visible);
      if (visible) wx.nextTick(() => this.measure());
    },
  },
  lifetimes: {
    attached() {
      const resize = () => { if (this.data.show) wx.nextTick(() => this.measure()); };
      resizeHandlers.set(this, resize);
      wx.onWindowResize(resize);
      wx.onKeyboardHeightChange(resize);
      if (this.data.show) updateTabBar(this, true);
    },
    detached() {
      const resize = resizeHandlers.get(this);
      if (resize) {
        wx.offWindowResize(resize);
        wx.offKeyboardHeightChange(resize);
        resizeHandlers.delete(this);
      }
      updateTabBar(this, false);
    },
  },
  pageLifetimes: {
    show() {
      if (this.data.show) { updateTabBar(this, true); wx.nextTick(() => this.measure()); }
      else restoreTabBar();
    },
    hide() {
      updateTabBar(this, false);
      if (this.data.show) this.triggerEvent('close');
    },
    resize() { if (this.data.show) wx.nextTick(() => this.measure()); },
  },
  methods: {
    close() { updateTabBar(this, false); this.triggerEvent('close'); }, stop() {},
    measure(){
      const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();
      const query = this.createSelectorQuery();
      query.selectViewport().boundingClientRect();
      query.select('.sheet-content').boundingClientRect();
      query.select('.sheet-head').boundingClientRect();
      query.exec(results => {
        const [viewport, content, header] = results;
        if (!content) return;
        const height = viewport?.height || info.windowHeight;
        const safeBottom = info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
        this.setData({ bodyHeight: Math.min(content.height, Math.max(80, height * .88 - (header?.height || 60) - safeBottom)) });
      });
    },
  },
});
