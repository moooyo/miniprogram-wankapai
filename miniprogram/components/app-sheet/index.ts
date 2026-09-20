Component({
  options: { multipleSlots: true },
  properties: { show: { type: Boolean, value: false }, title: { type: String, value: '' } },
  data: { bodyHeight: 200 },
  observers: { show(visible:boolean) { if(visible)wx.nextTick(()=>this.measure()); } },
  methods: {
    close() { this.triggerEvent('close'); }, stop() {},
    measure(){
      const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();
      this.createSelectorQuery().select('.sheet-content').boundingClientRect(rect=>{
        if(rect&&!Array.isArray(rect))this.setData({bodyHeight:Math.min(rect.height,Math.max(120,info.windowHeight*.88-80))});
      }).exec();
    },
  },
});
