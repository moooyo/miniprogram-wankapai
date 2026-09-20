import settings from '../../runtime-config';
Page({
  data:{url:'',error:''},
  onLoad(options:Record<string,string|undefined>){
    let url='';try{url=decodeURIComponent(options.url||'');}catch{}
    const host=/^https:\/\/([^/:?#]+)(?:[/?#]|$)/i.exec(url)?.[1].toLowerCase();
    if(!settings.webViewEnabled||!host||!(settings.allowedWebViewHosts as string[]).includes(host)){
      this.setData({error:'此网页入口暂不支持在小程序内打开，请返回后复制地址。'});return;
    }
    this.setData({url});
  },
  goBack(){wx.navigateBack();},
});
