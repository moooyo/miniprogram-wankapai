import { initialize } from './services/api';
import { initializePrivacy } from './services/privacy';

App({
  onLaunch() { initialize(); initializePrivacy(); },
  globalData: {},
});
