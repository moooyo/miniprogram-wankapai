import { initialize, installDesignDemoFixtures } from './services/api';
import { initializePrivacy } from './services/privacy';
import { fonts } from './assets/fonts/sources';

App({
  onLaunch() {
    initialize(); initializePrivacy();
    for (const font of fonts) wx.loadFontFace({ global:true, family:'DM Mono', source:font.source, desc:{weight:font.weight}, fail() {} });
  },
  installDesignDemoFixtures,
  globalData: {},
});
