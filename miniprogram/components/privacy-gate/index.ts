import { observePrivacy, privacyPending, resolvePrivacy } from '../../services/privacy';
const subscriptions=new WeakMap<object,()=>void>();
Component({
  data:{visible:false,active:true},
  lifetimes:{
    attached(){
      subscriptions.set(this,observePrivacy(visible=>{if(!visible||this.data.active)this.setData({visible});}));
    },
    detached(){subscriptions.get(this)?.();subscriptions.delete(this);},
  },
  pageLifetimes:{show(){this.setData({active:true});if(privacyPending())this.setData({visible:true});},hide(){this.setData({active:false});}},
  methods:{
    agree(){resolvePrivacy(true);},
    reject(){resolvePrivacy(false);},
    openPolicy(){wx.openPrivacyContract({fail:()=>wx.showToast({title:'隐私指引暂不可用，请稍后重试。',icon:'none'})});},
    stop(){},
  },
});
