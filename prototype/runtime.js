const manifest = window.PROTOTYPE_MANIFEST;
const definitions = new Map();
const visited = new Set();
const performed = new Set();
const pageHost = document.getElementById('native-page');
const shadow = pageHost.attachShadow({ mode: 'open' });
const storagePrefix = 'wankapai.prototype.';
const memoryStorage = new Map();
const storageOverrides = new Map();
const storageDeleted = Symbol('storage-deleted');
let storageResetUncertain = false;
let storageReadUnavailable = false;
const tabRoutes = new Set(manifest.config.tabBar.list.map(tab => tab.pagePath));
const stack = [];
const tabPages = new Map();
let services;
let scenarioQuery;
let preparationQuery;
let current;
let renderQueued = false;
let compositionSession = null;
let modalQueue = Promise.resolve();
let toastTimer;
let privacyResolver;
let nextQueryFailure = false;
let nextCommandFailure = false;
let refreshReadEffect = null;
let previousSheetId = '';
let sheetReturnKey = '';
let eventKey = '';
let previousFocusRequestKey = '';
let lastViewportSize = '';
let prototypePageSequence = 0;
let prototypeUnstableKeySequence = 0;
let demoRoleRevision = 0;
let reviewScenarioSequence = 0;
let departureRequest = null;
const platformDialogs = [];

const atlasGroups = [
  ['持有权益', [['entitlements', '当前持有权益'], ['entitlement-edit', '添加／编辑权益'], ['lounges', '机场贵宾厅速查']]],
  ['日常记录', [['todo', '待办'], ['activities', '活动'], ['rewards', '收益'], ['wallet', '卡包'], ['mine', '我的']]],
  ['活动与收益', [['detail', '活动详情'], ['progress', '更新进度'], ['receipt', '确认到账／优惠'], ['history', '参与与操作记录'], ['web-entry', '网页入口']]],
  ['卡片与投稿', [['card-edit', '添加／编辑卡片'], ['submissions', '我的投稿'], ['submission-lead', '分享活动线索'], ['submission-edit', '完整活动投稿'], ['review', '运营审核'], ['preferences', '提醒偏好']]],
];
const routeFor = name => `pages/${name}/index`;
const titleFor = route => atlasGroups.flatMap(group => group[1]).find(([name]) => routeFor(name) === route)?.[1] || '权益清单';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const feedback = text => { document.getElementById('scenario-feedback').textContent = text; };
const deferred = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function updateStorageNotice() {
  const message = storageOverrides.size || storageResetUncertain
    ? '浏览器未能持久保存本次修改，目前仅在此页面暂存。请勿刷新或关闭；演示中的“已保存”仅表示本页记录已更新。'
    : storageReadUnavailable ? '浏览器保存内容暂时无法读取，目前使用此页面的临时副本。请保持页面打开，避免丢失未持久保存的修改。' : '';
  let notice = document.getElementById('prototype-storage-warning');
  if (!notice && message) {
    notice = element('div'); notice.id = 'prototype-storage-warning';
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    notice.style.cssText = 'width:100%;max-width:430px;padding:12px;margin-bottom:12px;border:1px solid #d7bd7a;border-radius:8px;background:#fff4d6;color:#714519;font-size:14px;line-height:1.6;';
    const toolbar = document.querySelector('.preview-toolbar'); toolbar.parentNode.insertBefore(notice, toolbar);
  }
  if (notice) { if (notice.textContent !== message) notice.textContent = message; notice.hidden = !message; }
}

function getStorageSync(key) {
  if (storageOverrides.has(key)) {
    const value = storageOverrides.get(key); return value === storageDeleted ? undefined : clone(value);
  }
  if (storageResetUncertain) return clone(memoryStorage.get(key));
  try {
    const stored = localStorage.getItem(storagePrefix + key);
    const value = stored === null ? undefined : JSON.parse(stored);
    if (stored === null) memoryStorage.delete(key); else memoryStorage.set(key, clone(value));
    if (storageReadUnavailable) { storageReadUnavailable = false; updateStorageNotice(); }
    return clone(value);
  } catch {
    storageReadUnavailable = true; updateStorageNotice();
    return clone(memoryStorage.get(key));
  }
}
function setStorageSync(key, value) {
  const saved = clone(value); memoryStorage.set(key, saved);
  try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); storageOverrides.delete(key); }
  catch { storageOverrides.set(key, saved); }
  updateStorageNotice();
}
function removeStorageSync(key) {
  memoryStorage.delete(key);
  try { localStorage.removeItem(storagePrefix + key); storageOverrides.delete(key); }
  catch { storageOverrides.set(key, storageDeleted); }
  updateStorageNotice();
}

function resetStorage() {
  const keys = new Set([...memoryStorage.keys(), ...storageOverrides.keys()]);
  let enumerated = false;
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(storagePrefix)) keys.add(key.slice(storagePrefix.length));
    enumerated = true;
  } catch {}
  memoryStorage.clear(); storageOverrides.clear();
  storageResetUncertain = !enumerated; storageReadUnavailable = false;
  for (const key of keys) removeStorageSync(key);
  updateStorageNotice();
}
function imageSource(source) {
  return manifest.assets[source] || (String(source || '').startsWith('prototype-file://') ? getStorageSync(`image:${source}`) : source) || '';
}

function showToast(options) {
  clearTimeout(toastTimer);
  document.getElementById('toast').textContent = options.title || '';
  toastTimer = setTimeout(() => { document.getElementById('toast').textContent = ''; }, Math.max(options.duration || 2400, 1800));
  options.success?.({ errMsg: 'showToast:ok' });
}

function clearComposition(owner) {
  const session = compositionSession;
  if (!session || (owner && session.owner !== owner)) return;
  clearTimeout(session.releaseTimer);
  compositionSession = null;
}

function releaseCompositionAfterInput(session) {
  if (compositionSession !== session) return;
  session.ending = true;
  clearTimeout(session.releaseTimer);
  // Some browsers deliver the final input after compositionend or blur.
  session.releaseTimer = setTimeout(() => {
    if (compositionSession !== session) return;
    compositionSession = null;
    if (current === session.owner && !session.owner.disposed) scheduleRender();
  }, 0);
}

function trackComposition(target, owner) {
  const begin = () => {
    if (current !== owner || owner.disposed || !target.isConnected || target.disabled) return;
    clearComposition();
    compositionSession = { owner, target, ending: false, releaseTimer: undefined };
  };
  const end = () => {
    const session = compositionSession;
    if (session?.owner === owner && session.target === target) releaseCompositionAfterInput(session);
  };
  target.addEventListener('compositionstart', begin);
  target.addEventListener('input', event => {
    if (event.isComposing && compositionSession?.target !== target) begin();
  });
  target.addEventListener('compositionend', end);
  target.addEventListener('blur', end);
}

function composingEvent(event, owner) {
  return event.isComposing || (compositionSession?.owner === owner
    && compositionSession.target === event.target && !compositionSession.ending);
}

function activeSheetPanel() {
  return [...shadow.querySelectorAll('[data-sheet-dialog]')].at(-1) || null;
}

function focusPageControl(target, selection, reveal = false) {
  if (platformDialogs.length || !target?.isConnected || target.disabled || !target.getClientRects().length) return false;
  const sheet = activeSheetPanel();
  if (sheet && !sheet.contains(target)) return false;
  target.focus?.({ preventScroll: true });
  if (selection && target.setSelectionRange) { try { target.setSelectionRange(...selection); } catch {} }
  const focused = shadow.activeElement === target || document.activeElement === target;
  if (focused && reveal) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  return focused;
}

function focusPlatformControl(target, reveal = false) {
  if (target && platformDialogs.at(-1)?.panel.contains(target)) {
    target.focus({ preventScroll: true });
    if (reveal) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  }
}

function sheetControls(panel) {
  return [...panel.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(target => !target.disabled && target.tabIndex >= 0 && target.getClientRects().length);
}

function ensureSheetFocus(preferFirst = false) {
  if (platformDialogs.length) return;
  const panel = activeSheetPanel();
  if (!panel) return;
  const active = shadow.activeElement;
  if (active && panel.contains(active) && !active.disabled) return;
  const target = preferFirst ? sheetControls(panel)[0] || panel : panel;
  focusPageControl(target);
}

function syncSheetFocusOwnership() {
  for (const node of shadow.querySelectorAll('[data-sheet-background]')) { node.inert = false; delete node.dataset.sheetBackground; }
  const panel = activeSheetPanel();
  let branch = panel?.closest('[data-sheet-id]');
  while (branch) {
    const parent = branch.parentNode;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== branch && sibling.tagName !== 'STYLE') { sibling.inert = true; sibling.dataset.sheetBackground = 'true'; }
    }
    if (parent === shadow) break;
    branch = parent;
  }
  document.getElementById('native-back').tabIndex = panel ? -1 : 0;
}

function syncPlatformFocusOwnership() {
  for (const region of [pageHost, document.getElementById('native-tabs'), document.querySelector('.native-navigation')]) {
    if (region) region.inert = platformDialogs.length > 0;
  }
}

function locateBoundAction(target) {
  if (platformDialogs.length || !target?.isConnected || !target.getClientRects().length || target.closest('[inert]')) return false;
  const sheet = activeSheetPanel();
  if (sheet && !sheet.contains(target)) return false;
  const selector = 'button,input:not([type="hidden"]),select,textarea,a[href],[tabindex]';
  const controls = [target, ...target.querySelectorAll(selector)];
  const control = controls.find(node => node.matches(selector) && !node.disabled && node.tabIndex >= 0 && !node.closest('[inert]') && node.getClientRects().length);
  if (control) return focusPageControl(control, undefined, true);
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  return true;
}

function dialog(options) {
  return new Promise(resolve => {
    const layer = document.getElementById('platform-layer');
    const panel = element('div', 'platform-dialog');
    const priorFocus = shadow.activeElement || document.activeElement;
    const context = {
      panel, owner: current, priorFocus, priorKey: priorFocus?.dataset.renderKey || '',
      selection: priorFocus && 'selectionStart' in priorFocus ? [priorFocus.selectionStart, priorFocus.selectionEnd] : null,
    };
    const composition = compositionSession;
    if (composition?.owner === current) {
      composition.target.blur();
      releaseCompositionAfterInput(composition);
    }
    platformDialogs.push(context);
    syncPlatformFocusOwnership();
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', options.title || '提示');
    if (options.platform) panel.append(element('div', 'platform-label', '浏览器演示 · 微信平台能力模拟'));
    panel.append(element('h2', '', options.title || '提示'));
    if (options.content) panel.append(element('p', '', options.content));
    if (options.image) { const img = element('img'); img.src = options.image; img.alt = '活动入口预览'; panel.append(img); }
    if (options.clipboard) { const input = element('textarea'); input.value = options.clipboard; input.readOnly = true; input.setAttribute('aria-label', '复制内容'); panel.append(input); }
    if (options.policyLink) {
      const link = element('button', 'privacy-policy-link', '阅读《用户隐私保护指引》'); link.dataset.handler = 'privacy-gate.openPolicy';
      link.onclick = async () => {
        performed.add('component:privacy-gate.openPolicy');
        await dialog({ title: '用户隐私保护指引', content: '这是原型中的隐私指引预览。\n\n图片：仅使用你主动选择的活动规则或入口截图。\n个人记录：卡包、参与进度、收益和还款记录不公开。\n公开投稿：仅在运营审核通过后公开活动规则和入口，不公开个人记录。\n\n正式小程序将打开微信配置的隐私保护指引。', platform: true, showCancel: false, confirmText: '返回授权' });
        if (!platformDialogs.includes(context)) return;
        layer.replaceChildren(panel); focusPlatformControl(link);
      };
      panel.append(link);
    }
    const actions = element('div', 'platform-actions');
    const complete = confirm => {
      if (platformDialogs.at(-1) !== context) return;
      layer.replaceChildren();
      platformDialogs.pop();
      syncPlatformFocusOwnership();
      const result = { confirm, cancel: !confirm, errMsg: 'showModal:ok' };
      options.success?.(result); options.complete?.(result);
      resolve(result);
      if (!platformDialogs.length && current === context.owner) {
        const controls = [...shadow.querySelectorAll('[data-render-key]')];
        const requested = controls.find(node => node.dataset.renderKey === current?._pendingFocusRequestKey && node.dataset.requestFocus);
        const restored = context.priorKey ? controls.find(node => node.dataset.renderKey === context.priorKey) : context.priorFocus;
        if (current) current._pendingFocusRequestKey = '';
        if (!focusPageControl(requested)) focusPageControl(restored, context.selection);
        ensureSheetFocus();
      }
    };
    context.close = complete;
    if (options.showCancel !== false) { const cancel = element('button', '', options.cancelText || '取消'); cancel.onclick = () => complete(false); actions.append(cancel); }
    const confirm = element('button', '', options.confirmText || '确定'); confirm.onclick = () => complete(true); actions.append(confirm);
    panel.append(actions); layer.replaceChildren(panel);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && options.showCancel !== false) { event.preventDefault(); complete(false); }
      if (event.key === 'Tab') {
        const controls = [...panel.querySelectorAll('button,textarea')];
        const index = controls.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); focusPlatformControl(controls.at(-1), true); }
        else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); focusPlatformControl(controls[0], true); }
      }
    });
    focusPlatformControl(actions.querySelector('button'));
  });
}
function showModal(options) {
  const pending = modalQueue.then(() => dialog(options));
  modalQueue = pending.catch(() => {});
  return pending;
}

function browserOperation(options, result = {}) {
  options?.success?.(result); options?.complete?.(result);
  return Promise.resolve(result);
}

window.wx = {
  getStorageSync, setStorageSync, removeStorageSync,
  showToast, showModal,
  navigateTo: options => navigate(options.url, 'push', options),
  redirectTo: options => navigate(options.url, 'replace', options),
  switchTab: options => navigate(options.url, 'tab', options),
  reLaunch: options => navigate(options.url, 'tab', options),
  navigateBack: options => goBack(options?.delta || 1, options),
  setNavigationBarTitle(options) { if (current) current._title = options.title; document.getElementById('native-title').textContent = options.title; },
  enableAlertBeforeUnload(options) { if (current) current._leaveMessage = options.message; },
  disableAlertBeforeUnload() { if (current) current._leaveMessage = ''; },
  nextTick(callback) { requestAnimationFrame(callback); },
  stopPullDownRefresh() {},
  showNavigationBarLoading() { document.getElementById('native-title').setAttribute('aria-busy', 'true'); },
  hideNavigationBarLoading() { document.getElementById('native-title').removeAttribute('aria-busy'); },
  hideTabBar(options) { document.getElementById('native-tabs').hidden = true; return browserOperation(options); },
  showTabBar(options) { document.getElementById('native-tabs').hidden = !tabRoutes.has(current?.route); return browserOperation(options); },
  pageScrollTo(options) {
    requestAnimationFrame(() => {
      const target = options.selector ? shadow.querySelector(options.selector) : null;
      if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });
      else pageHost.scrollTo({ top: options.scrollTop || 0, behavior: 'auto' });
    });
    return browserOperation(options);
  },
  getWindowInfo() { return { windowWidth: pageHost.clientWidth, windowHeight: pageHost.clientHeight, screenHeight: pageHost.clientHeight, safeArea: { bottom: pageHost.clientHeight } }; },
  getSystemInfoSync() { return this.getWindowInfo(); },
  onWindowResize() {}, offWindowResize() {}, onKeyboardHeightChange() {}, offKeyboardHeightChange() {},
  onNeedPrivacyAuthorization(callback) { privacyResolver = callback; },
  openPrivacyContract(options = {}) {
    return showModal({ title: '个人信息保护指引', content: '这是原型中的隐私说明预览。真实小程序将打开微信配置的隐私保护指引。卡包、进度和收益不公开；投稿仅在审核通过后公开活动内容。', platform: true, showCancel: false, confirmText: '返回' }).then(() => browserOperation(options));
  },
  async setClipboardData(options) {
    let copied = false;
    try { await navigator.clipboard.writeText(options.data); copied = true; } catch {}
    if (!copied) await showModal({ title: '复制内容', content: '当前浏览器不允许自动复制，可选中下方内容复制。', clipboard: options.data, platform: true, showCancel: false, confirmText: '继续' });
    return browserOperation(options, { errMsg: 'setClipboardData:ok' });
  },
  async navigateToMiniProgram(options) {
    const result = await showModal({ title: '即将打开银行小程序', content: options.shortLink || `AppID：${options.appId}\n页面：${options.path || '首页'}\n\n原型不会实际跳转，确认后返回当前记录。`, platform: true, confirmText: '模拟已打开' });
    if (result.confirm) return browserOperation(options, { errMsg: 'navigateToMiniProgram:ok' });
    const error = { errMsg: 'navigateToMiniProgram:fail cancel' }; options.fail?.(error); return error;
  },
  requestSubscribeMessage(options) { return browserOperation(options, Object.fromEntries(options.tmplIds.map(id => [id, 'reject']))); },
  chooseMedia(options) {
    const input = element('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    input.style.display = 'none'; document.body.append(input);
    input.oncancel = () => { input.remove(); options.fail?.({ errMsg: 'chooseMedia:fail cancel' }); };
    input.onchange = async () => {
      const file = input.files?.[0]; input.remove();
      if (!file) { options.fail?.({ errMsg: 'chooseMedia:fail cancel' }); return; }
      const reader = new FileReader();
      reader.onload = () => options.success?.({ tempFiles: [{ tempFilePath: reader.result, size: file.size, fileType: 'image' }], type: 'image' });
      reader.onerror = () => options.fail?.({ errMsg: '图片读取失败，请重试。' }); reader.readAsDataURL(file);
    };
    input.click();
  },
  getImageInfo(options) {
    const type = /^data:image\/(png|jpeg|webp);/.exec(options.src)?.[1];
    if (!type) { options.fail?.({ errMsg: '请选择 JPG、PNG 或 WebP 图片。' }); return; }
    return browserOperation(options, { type, width: 100, height: 100, path: options.src });
  },
  getFileSystemManager() { return { saveFile(options) { const fileId = `prototype-file://${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; setStorageSync(`image:${fileId}`, options.tempFilePath); return browserOperation(options, { savedFilePath: fileId }); } }; },
  async previewImage(options) {
    await showModal({ title: '活动图片', image: imageSource(options.current || options.urls[0]), showCancel: false, confirmText: '关闭预览' });
    return browserOperation(options, { errMsg: 'previewImage:ok' });
  },
  cloud: { init() {}, callFunction() { throw new Error('原型仅支持演示服务。'); } },
};
window.getCurrentPages = () => stack;
window.getApp = () => ({ globalData: {} });
window.App = () => {};
window.Component = () => {};

function evaluate(expression, scope) {
  try { return Function('scope', `with(scope){return (${manifest.expressions[expression] || expression});}`)(scope); }
  catch { return undefined; }
}
function valueOf(value, scope) {
  if (typeof value !== 'string') return value;
  const whole = /^{{((?:(?!{{|}})[\s\S])*?)}}$/.exec(value);
  if (whole) return evaluate(whole[1], scope);
  return value.replace(/{{([\s\S]*?)}}/g, (_, expression) => String(evaluate(expression, scope) ?? ''));
}
function setPath(object, key, value) {
  const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = object;
  for (let i = 0; i < keys.length - 1; i++) { cursor[keys[i]] ??= /^\d+$/.test(keys[i + 1]) ? [] : {}; cursor = cursor[keys[i]]; }
  cursor[keys.at(-1)] = value;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}
async function invoke(owner, handler, event = {}) {
  if (typeof owner?.[handler] !== 'function') { feedback(`此操作未找到处理函数：${handler}`); return; }
  performed.add(`${owner.route}:${handler}`);
  try { const result = owner[handler](event); scheduleRender(); return await result; }
  catch (error) { showToast({ title: error.message || '操作未完成，请重试。' }); }
  finally { scheduleRender(); }
}

function eventFor(node, scope, target, detail) {
  const dataset = {};
  for (const [key, value] of Object.entries(node.attrs || {})) if (key.startsWith('data-')) dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = valueOf(value, scope);
  const id = String(valueOf(node.attrs?.id, scope) ?? target.id);
  return { currentTarget: { dataset, id }, target: { dataset, id }, detail };
}

function bindEvents(target, node, scope, owner) {
  for (const [binding, rawHandler] of Object.entries(node.attrs)) {
    if (!/^(bind|catch)/.test(binding)) continue;
    const eventName = binding.replace(/^(bind|catch):?/, '');
    if (eventName === 'close' || eventName === 'touchmove') continue;
    const handler = valueOf(rawHandler, scope);
    const domEvent = ({ tap: 'click', input: 'input', change: 'change', confirm: 'keydown', blur: 'blur', focus: 'focus', agreeprivacyauthorization: 'click', error: 'error' })[eventName] || eventName;
    target.dataset.handler = target.dataset.handler ? `${target.dataset.handler} ${handler}` : String(handler);
    target.addEventListener(domEvent, event => {
      if (current !== owner || owner.disposed || !target.isConnected) return;
      if (eventName === 'confirm' && (event.key !== 'Enter' || composingEvent(event, owner))) return;
      if (binding.startsWith('catch')) event.stopPropagation();
      if (target.disabled) return;
      eventKey = target.dataset.renderKey;
      let detail = { value: event.target.value };
      if (node.tag === 'switch') detail.value = event.target.checked;
      if (node.tag === 'checkbox-group') detail.value = [...target.querySelectorAll('input[type=checkbox]:checked')].map(input => input.value);
      if (eventName === 'tap') detail = { x: event.clientX || 0, y: event.clientY || 0 };
      void invoke(owner, handler, eventFor(node, scope, target, detail));
    });
  }
}

function loopItemKey(attrs, value, position) {
  if (!Object.prototype.hasOwnProperty.call(attrs, 'wx:key')) return `index:${encodeURIComponent(String(position))}`;
  const field = attrs['wx:key'];
  const identity = field === '*this' ? value : value?.[field];
  if (identity !== null && identity !== undefined && ['string', 'number', 'boolean'].includes(typeof identity)) {
    return `key:${typeof identity}:${encodeURIComponent(String(identity))}`;
  }
  // An invalid declared key cannot safely identify a row after a refresh.
  // Give it a fresh identity instead of restoring focus to an unrelated index.
  return `unstable:${++prototypeUnstableKeySequence}`;
}

function renderNodes(nodes, scope, parent, owner, prefix = '') {
  let branchTaken = false;
  let inBranch = false;
  nodes.forEach((node, index) => {
    const key = `${prefix}/${index}`;
    if (node.text !== undefined) { parent.append(document.createTextNode(valueOf(node.text, scope) ?? '')); return; }
    const attrs = node.attrs;
    if (attrs['wx:for'] !== undefined) {
      const values = valueOf(attrs['wx:for'], scope) || [];
      const entries = Array.isArray(values) ? values.map((value, position) => [position, value]) : Object.entries(values);
      for (const [position, value] of entries) {
        const childScope = { ...scope, [attrs['wx:for-item'] || 'item']: value, [attrs['wx:for-index'] || 'index']: position };
        const itemNode = { ...node, attrs: { ...attrs } }; delete itemNode.attrs['wx:for'];
        renderNodes([itemNode], childScope, parent, owner, `${key}:item:${loopItemKey(attrs, value, position)}`);
      }
      inBranch = false; return;
    }
    if (attrs['wx:if'] !== undefined) { inBranch = true; branchTaken = !!valueOf(attrs['wx:if'], scope); if (!branchTaken) return; }
    else if (attrs['wx:elif'] !== undefined) { if (!inBranch || branchTaken) return; branchTaken = !!valueOf(attrs['wx:elif'], scope); if (!branchTaken) return; }
    else if (attrs['wx:else'] !== undefined) { if (!inBranch || branchTaken) return; branchTaken = true; }
    else inBranch = false;
    if (node.tag === 'block' || node.tag === 'root') { renderNodes(node.children, scope, parent, owner, key); return; }
    if (node.tag === 'app-sheet') { renderSheet(node, scope, parent, owner, key); return; }
    if (node.tag === 'privacy-gate' || node.tag === 'demo-notice') return;
    const tag = ({ view: 'div', text: 'span', image: 'img', 'scroll-view': 'div', picker: 'div', switch: 'span', checkbox: 'input', 'checkbox-group': 'div', 'web-view': 'div' })[node.tag] || node.tag;
    const target = element(tag);
    target.dataset.renderKey = key;
    target.dataset.wxTag = node.tag;
    for (const [name, original] of Object.entries(attrs)) {
      if (/^(wx:|bind|catch)/.test(name) || ['range', 'range-key', 'value', 'checked', 'disabled', 'loading', 'focus', 'type', 'src', 'percent'].includes(name)) continue;
      const value = valueOf(original, scope);
      if (value !== undefined && value !== false && value !== null) target.setAttribute(name, String(value));
      else if (name.startsWith('aria-')) target.setAttribute(name, String(value ?? false));
    }
    if (attrs.hidden !== undefined && valueOf(attrs.hidden, scope)) target.hidden = true;
    if (attrs.disabled !== undefined) target.disabled = !!valueOf(attrs.disabled, scope);
    if (attrs.loading !== undefined && valueOf(attrs.loading, scope)) { target.setAttribute('aria-busy', 'true'); target.classList.add('prototype-loading'); }
    if (node.tag === 'image') {
      const src = valueOf(attrs.src, scope); target.src = imageSource(src); target.alt = valueOf(attrs['aria-label'], scope) || '';
      target.style.objectFit = attrs.mode === 'aspectFill' ? 'cover' : 'contain';
      if (attrs.mode === 'widthFix') target.style.height = 'auto';
    } else if (node.tag === 'switch') {
      target.classList.add('prototype-switch-hit');
      const control = element('input', 'prototype-switch'); control.type = 'checkbox'; control.checked = !!valueOf(attrs.checked, scope); control.disabled = !!valueOf(attrs.disabled, scope);
      // Keep the source ID on the labelable control while retaining the wrapper's touch target.
      if (target.hasAttribute('id')) { control.id = target.id; target.removeAttribute('id'); }
      control.setAttribute('role', 'switch');
      const accessibleLabel = valueOf(attrs['aria-label'], scope);
      if (accessibleLabel) control.setAttribute('aria-label', accessibleLabel);
      else if (!parent.closest?.('label')) control.setAttribute('aria-label', parent.textContent.trim() || '开关');
      control.dataset.renderKey = `${key}:switch`;
      target.append(control); target.addEventListener('click', event => { if (event.target === target && !control.disabled) { event.preventDefault(); control.click(); } });
    } else if (node.tag === 'checkbox') {
      target.type = 'checkbox'; target.checked = !!valueOf(attrs.checked, scope); target.value = valueOf(attrs.value, scope) || 'on';
    } else if (node.tag === 'input' || node.tag === 'textarea') {
      if (node.tag === 'input') { target.type = ['number', 'digit'].includes(attrs.type) ? 'text' : attrs.type || 'text'; if (['number', 'digit'].includes(attrs.type)) target.inputMode = 'decimal'; }
      target.value = valueOf(attrs.value, scope) ?? '';
      if (valueOf(attrs.focus, scope)) target.dataset.requestFocus = 'true';
      trackComposition(target, owner);
    } else if (node.tag === 'progress') {
      target.max = 100; target.value = valueOf(attrs.percent, scope) || 0;
    } else if (node.tag === 'picker') {
      renderNodes(node.children, scope, target, owner, key);
      const dateMode = attrs.mode === 'date';
      const control = element(dateMode ? 'input' : 'select', 'prototype-picker-control');
      control.dataset.renderKey = `${key}:picker`;
      control.disabled = !!valueOf(attrs.disabled, scope);
      control.setAttribute('aria-label', valueOf(attrs['aria-label'], scope) || target.textContent.trim() || '选择');
      if (dateMode) {
        control.type = attrs.fields === 'month' ? 'month' : 'date';
        control.value = valueOf(attrs.value, scope) || '';
        if (attrs.start) control.min = valueOf(attrs.start, scope) || '';
        if (attrs.end) control.max = valueOf(attrs.end, scope) || '';
      } else {
        const range = valueOf(attrs.range, scope) || [];
        range.forEach((item, index) => { const option = element('option', '', attrs['range-key'] ? item[attrs['range-key']] : item); option.value = String(index); control.append(option); });
        control.value = String(valueOf(attrs.value, scope) ?? 0);
      }
      bindEvents(control, node, scope, owner); target.append(control); parent.append(target); return;
    } else if (node.tag === 'web-view') {
      target.className = 'prototype-webview'; target.append(element('strong', '', '网页入口预览'), element('p', '', valueOf(attrs.src, scope) || ''), element('p', '', '网页载入依赖微信业务域名配置；浏览器原型不嵌入外部银行页面。'));
    }
    if (!['image', 'input', 'switch', 'checkbox', 'textarea', 'progress', 'web-view'].includes(node.tag)) renderNodes(node.children, scope, target, owner, key);
    if (attrs['scroll-x'] !== undefined) { target.style.overflowX = 'auto'; target.style.overflowY = 'hidden'; }
    if (attrs['scroll-y'] !== undefined) target.style.overflowY = 'auto';
    bindEvents(target, node, scope, owner); parent.append(target);
  });
}

function renderSheet(node, scope, parent, owner, key) {
  if (!valueOf(node.attrs.show, scope)) return;
  const layer = element('div', 'sheet-layer'); layer.dataset.sheetId = node.attrs.id || key;
  layer.dataset.scrollTarget = valueOf(node.attrs['scroll-into-view'], scope) || '';
  const mask = element('div', 'sheet-mask');
  layer.dataset.wxTag = 'view'; mask.dataset.wxTag = 'view';
  const closeHandler = node.attrs.bindclose || node.attrs['bind:close'];
  const dismissible = node.attrs.dismissible === undefined || !!valueOf(node.attrs.dismissible, scope);
  const close = () => { if (!dismissible) return; performed.add('component:app-sheet.close'); return invoke(owner, closeHandler); };
  mask.onclick = close;
  for (const eventName of ['wheel', 'touchmove']) mask.addEventListener(eventName, event => { event.preventDefault(); performed.add('component:app-sheet.stop'); }, { passive: false });
  const panel = element('section', 'sheet'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', valueOf(node.attrs.title, scope) || '操作面板');
  panel.dataset.wxTag = 'view'; panel.dataset.sheetDialog = node.attrs.id || key; panel.tabIndex = -1;
  panel.dataset.renderKey = `page:${owner._instanceId}:sheet:${node.attrs.id || key}:dialog`;
  const header = element('div', 'sheet-head'); header.dataset.wxTag = 'view'; const title = element('span', 'sheet-title', valueOf(node.attrs.title, scope)); title.dataset.wxTag = 'text'; header.append(title);
  const closeButton = element('button', 'sheet-close', '×'); closeButton.setAttribute('aria-label', '关闭面板'); closeButton.dataset.renderKey = `${key}:close`; closeButton.onclick = close;
  closeButton.disabled = !dismissible;
  closeButton.dataset.handler = 'app-sheet.close';
  header.append(closeButton);
  const body = element('div', 'sheet-body'); body.dataset.wxTag = 'scroll-view'; body.dataset.renderKey = `page:${owner._instanceId}:sheet:${node.attrs.id || key}:body`;
  const content = element('div', 'sheet-content'); content.dataset.wxTag = 'view'; renderNodes(node.children, scope, content, owner, key); body.append(content);
  panel.append(header, body); layer.append(mask, panel); parent.append(layer);
  panel.addEventListener('keydown', event => {
    if (platformDialogs.length) return;
    if (event.key === 'Escape' && !composingEvent(event, owner)) { event.preventDefault(); event.stopPropagation(); if (dismissible) void close(); }
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      const controls = sheetControls(panel);
      if (!controls.length) { focusPageControl(panel); return; }
      const index = controls.indexOf(shadow.activeElement);
      const next = index < 0 ? event.shiftKey ? controls.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      focusPageControl(controls[next], undefined, true);
    }
  });
}

const adapterCss = `
:host{display:block;min-height:100%;--brand:#1f61d8;--ink:#172230;--muted:#626f82;--line:#e5ebf3;--surface:#fff;--page:#f4f7fb;color:var(--ink);background:var(--page);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.55}
*{box-sizing:border-box}button,input,textarea,select{font:inherit}button{border:0;cursor:pointer;background:#f8f8f8;color:inherit}button:disabled{cursor:not-allowed}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #1456b8;outline-offset:2px}input,textarea{min-width:0;border:0;background:transparent;color:inherit}textarea{width:100%;min-height:90px;resize:vertical}img{display:inline-block}img:not([src]){visibility:hidden}[hidden]{display:none!important}[data-wx-tag=picker]{position:relative;cursor:pointer}.prototype-picker-control{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;min-height:36px}.prototype-picker-control:focus-visible{opacity:.12}.prototype-switch{appearance:none!important;width:43px!important;height:26px!important;min-width:43px;flex:0 0 43px;position:relative;border:0!important;border-radius:20px!important;background:#a5b3c6!important;margin:5px 0;padding:0!important;cursor:pointer}.prototype-switch::before{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;background:white;border-radius:50%;box-shadow:0 1px 3px #0002;transition:transform .15s}.prototype-switch:checked{background:#1f61d8!important}.prototype-switch:checked::before{transform:translateX(17px)}input[type=checkbox]:not(.prototype-switch){width:20px;height:20px;min-height:20px;accent-color:#1f61d8;flex-shrink:0}progress{width:100%;height:4px;border:0;border-radius:4px;overflow:hidden;accent-color:#568be5}.prototype-loading::before{content:'';display:inline-block;width:13px;height:13px;min-width:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;margin-right:7px;animation:prototype-spin 1s linear infinite}.sheet-layer{z-index:45!important;position:fixed!important;inset:73px 0 0!important}.sheet{max-height:88%;display:flex!important;flex-direction:column}.sheet-body{height:auto!important;max-height:calc(80vh - 120px);overflow-y:auto;overscroll-behavior:contain}.sheet-content{min-height:0}.sheet-head{flex-shrink:0}.prototype-webview{padding:24px;font-size:14px;overflow-wrap:anywhere}.prototype-demo-notice{padding:7px 16px;background:#edf4ff;color:#526780;font-size:12px;line-height:1.5}
@keyframes prototype-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
.sheet:focus-visible{outline:2px solid #1456b8;outline-offset:-2px}
`;

function viewportCss(css) {
  return css.replace(/@media\s*([^{}]+)\{/g, (_, query) => {
    const adapted = query.replace(/\((min|max)-(width|height)\s*:\s*([\d.]+)px\s*\)/g, (_match, bound, dimension, amount) => {
      const actual = dimension === 'width' ? pageHost.clientWidth : pageHost.clientHeight;
      const matches = bound === 'max' ? actual <= Number(amount) : actual >= Number(amount);
      return matches ? '(min-width:0px)' : '(max-width:0px)';
    });
    return `@media ${adapted}{`;
  });
}

function render() {
  if (!current || !manifest.pages[current.route]) return;
  if (compositionSession) {
    if (compositionSession.owner === current && !current.disposed && compositionSession.target.isConnected) return;
    clearComposition();
  }
  const oldActive = shadow.activeElement;
  const oldSheetLayer = activeSheetPanel()?.closest('[data-sheet-id]');
  const oldSheetScroll = oldSheetLayer ? `${oldSheetLayer.dataset.sheetId}:${oldSheetLayer.dataset.scrollTarget || ''}` : '';
  const focusKey = oldActive?.dataset.renderKey;
  const selection = oldActive && 'selectionStart' in oldActive ? [oldActive.selectionStart, oldActive.selectionEnd] : null;
  const scrollTop = pageHost.scrollTop;
  const scrollStates = [...shadow.querySelectorAll('[data-render-key]')].filter(node => node.scrollTop || node.scrollLeft).map(node => [node.dataset.renderKey, node.scrollTop, node.scrollLeft]);
  const page = manifest.pages[current.route];
  const fragment = document.createDocumentFragment();
  const style = element('style'); style.textContent = adapterCss + viewportCss(manifest.appCss + page.css + manifest.sheetCss + manifest.demoCss) + '.prototype-switch-hit{display:flex;align-items:center;justify-content:center;min-width:48px;min-height:48px;flex-shrink:0}.sheet-body{max-height:calc(88 * var(--prototype-vh,7px) - 60px)!important}'; fragment.append(style);
  if (current.route !== routeFor('web-entry')) renderNodes(manifest.components['demo-notice'].nodes, { visible: true }, fragment, current, 'demo');
  const wrapper = element('div', 'prototype-native-content'); renderNodes(page.nodes, current.data, wrapper, current); fragment.append(wrapper);
  shadow.replaceChildren(fragment);
  syncSheetFocusOwnership();
  pageHost.scrollTop = scrollTop;
  const findKey = key => [...shadow.querySelectorAll('[data-render-key]')].find(node => node.dataset.renderKey === key);
  scrollStates.forEach(([key, top, left]) => { const node = findKey(key); if (node) { node.scrollTop = top; node.scrollLeft = left; } });
  const newSheet = activeSheetPanel()?.closest('[data-sheet-id]');
  const requestedFocus = shadow.querySelector('[data-request-focus]');
  const requestKey = requestedFocus?.dataset.renderKey || '';
  if (requestKey !== previousFocusRequestKey) {
    if (platformDialogs.length && requestKey) current._pendingFocusRequestKey = requestKey;
    else current._pendingFocusRequestKey = '';
  }
  if (newSheet && newSheet.dataset.sheetId !== previousSheetId) { sheetReturnKey = eventKey || focusKey; ensureSheetFocus(true); }
  else if (!newSheet && previousSheetId) focusPageControl(findKey(sheetReturnKey));
  else if (requestedFocus && requestKey !== previousFocusRequestKey) focusPageControl(requestedFocus);
  else if (focusKey) {
    focusPageControl(findKey(focusKey), selection);
  }
  ensureSheetFocus();
  const sheetScroll = newSheet ? `${newSheet.dataset.sheetId}:${newSheet.dataset.scrollTarget || ''}` : '';
  if (newSheet?.dataset.scrollTarget && sheetScroll !== oldSheetScroll) {
    const target = [...newSheet.querySelectorAll('[id]')].find(node => node.id === newSheet.dataset.scrollTarget);
    requestAnimationFrame(() => { if (!platformDialogs.length && target?.isConnected) target.scrollIntoView({ block: 'start', behavior: 'auto' }); });
  }
  previousFocusRequestKey = requestKey;
  previousSheetId = newSheet?.dataset.sheetId || '';
  document.getElementById('native-tabs').hidden = !tabRoutes.has(current.route) || !!newSheet;
  renderInspector();
}

function createPage(route, options) {
  const definition = definitions.get(route);
  const instance = { route, options, _instanceId: ++prototypePageSequence, _title: manifest.pages[route].title, _leaveMessage: '' };
  for (const [key, value] of Object.entries(definition)) instance[key] = typeof value === 'function' ? value : clone(value);
  instance.data ||= {};
  instance.setData = function (patch, callback) { for (const [key, value] of Object.entries(patch)) setPath(this.data, key, value); if (current === this) scheduleRender(); if (callback) queueMicrotask(callback); };
  instance.createSelectorQuery = () => {
    const results = [];
    const query = { select(selector) { query.selected = selector; return query; }, selectViewport() { query.selected = null; return query; }, boundingClientRect() { results.push(query.selected ? shadow.querySelector(query.selected)?.getBoundingClientRect() : pageHost.getBoundingClientRect()); return query; }, exec(callback) { callback(results); } };
    return query;
  };
  instance.selectComponent = () => null;
  return instance;
}

async function mayLeave(owner, action = 'leave') {
  if (!owner?._leaveMessage) return true;
  const refreshing = action === 'refresh';
  const result = await showModal({ title: refreshing ? '重新加载当前页面？' : '离开当前页面？', content: owner._leaveMessage, confirmText: refreshing ? '重新加载' : '离开', cancelText: '继续填写' });
  return result.confirm;
}

function hideCurrentPage(owner) {
  if (!owner) return;
  owner._scrollTop = pageHost.scrollTop;
  owner._focusedKey = shadow.activeElement?.dataset.renderKey || '';
  owner._innerScroll = [...shadow.querySelectorAll('[data-render-key]')].filter(node => node.scrollTop || node.scrollLeft).map(node => [node.dataset.renderKey, node.scrollTop, node.scrollLeft]);
  clearComposition(owner);
  owner.onHide?.();
  // Hiding a page is not a user request to dismiss a sheet. The departure guard
  // already resolved that decision; emitting close here can create a second prompt.
  // A retained page keeps its sheet snapshot so Back can resume the same editor.
}

async function depart(commit, options = {}, confirmation, lifecycle = {}) {
  if (departureRequest) { options.fail?.({ errMsg: 'navigateTo:fail navigation pending' }); return false; }
  const request = { owner: current };
  departureRequest = request;
  try {
    const accepted = confirmation ? await confirmation() : await mayLeave(request.owner);
    if (!accepted || current !== request.owner || (lifecycle.canCommit && !lifecycle.canCommit())) { options.fail?.({ errMsg: 'navigateTo:fail cancel' }); return false; }
    departureRequest = null;
    if (lifecycle.hide !== false) hideCurrentPage(request.owner);
    return commit();
  } finally { if (departureRequest === request) departureRequest = null; }
}

function restorePagePosition(page) {
  pageHost.scrollTop = page._scrollTop || 0;
  const findKey = key => [...shadow.querySelectorAll('[data-render-key]')].find(node => node.dataset.renderKey === key);
  for (const [key, top, left] of page._innerScroll || []) { const node = findKey(key); if (node) { node.scrollTop = top; node.scrollLeft = left; } }
  if (page._focusedKey) focusPageControl(findKey(page._focusedKey));
}

function pageUrl(page) {
  const query = new URLSearchParams(Object.entries(page.options || {}).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])).toString();
  return `${page.route}${query ? '?' + query : ''}`;
}

function pageLoadOptions(page) {
  const options = { ...page.options };
  // Web Entry explicitly decodes the URL supplied by the source entrance dispatcher.
  // Keep canonical route options separate so Back and reload encode them only once.
  if (page.route === routeFor('web-entry') && typeof options.url === 'string') options.url = encodeURIComponent(options.url);
  return options;
}

function updateLocation(page) {
  try { history.replaceState({}, '', `#/${pageUrl(page)}`); } catch {}
}

function updateNavigation() {
  document.getElementById('native-title').textContent = current._title;
  document.getElementById('screen-position').textContent = `${titleFor(current.route)} · ${manifest.config.pages.indexOf(current.route) + 1} / ${manifest.config.pages.length}`;
  const isTab = tabRoutes.has(current.route);
  document.getElementById('native-back').style.visibility = isTab ? 'hidden' : 'visible';
  const tabs = document.getElementById('native-tabs'); tabs.replaceChildren(); tabs.hidden = !isTab;
  for (const tab of manifest.config.tabBar.list) {
    const selected = current.route === tab.pagePath;
    const button = element('button', selected ? 'active' : ''); button.setAttribute('aria-label', tab.text); button.setAttribute('aria-current', selected ? 'page' : 'false');
    const icon = element('img'); icon.src = manifest.assets['/' + (selected ? tab.selectedIconPath : tab.iconPath)]; icon.alt = '';
    button.append(icon, element('span', '', tab.text)); button.onclick = () => navigate(tab.pagePath, 'tab'); tabs.append(button);
  }
  document.querySelectorAll('.atlas-link').forEach(button => { button.classList.toggle('active', button.dataset.route === current.route); button.classList.toggle('visited', visited.has(button.dataset.route)); button.setAttribute('aria-current', button.dataset.route === current.route ? 'page' : 'false'); });
}

async function navigate(url, mode = 'push', options = {}) {
  const [pathname, query] = String(url).replace(/^\//, '').split('?');
  if (!definitions.has(pathname)) { showToast({ title: '这个页面暂不可用，请从页面导航图重新选择。' }); return; }
  return depart(() => activatePage(pathname, query, mode, options), options);
}

function workbenchReady(owner, announce = true) {
  if (!owner || current !== owner || owner.disposed) {
    if (announce) feedback('页面已变化，请重新选择操作。');
    return false;
  }
  if (platformDialogs.length) {
    if (announce) feedback('请先完成当前对话框。');
    return false;
  }
  const editor = ['card-edit', 'entitlement-edit', 'progress', 'receipt', 'submission-lead', 'submission-edit', 'preferences'].some(name => owner.route === routeFor(name));
  const loadingForm = editor && owner.data.loading && !owner.data.failed && !owner.data.loadError && !owner.data.error && !owner.data.denied;
  if (sourceOperationPending(owner) || owner._prototypeRefreshing || loadingForm) {
    if (announce) feedback('请等待当前操作完成后再切换页面。');
    return false;
  }
  return true;
}

function workbenchNavigate(url, mode = 'push', { owner = current, role } = {}) {
  if (!workbenchReady(owner)) return false;
  const [pathname, query] = String(url).replace(/^\//, '').split('?');
  if (!definitions.has(pathname)) { showToast({ title: '这个页面暂不可用，请从页面导航图重新选择。' }); return false; }
  return depart(() => {
    // Demo role changes are synchronous before the destination lifecycle starts.
    if (role) void services.setDemoRole(role);
    return activatePage(pathname, query, mode);
  }, {}, undefined, { canCommit: () => workbenchReady(owner) });
}

function activatePage(pathname, query, mode = 'push', options = {}) {
  clearComposition();
  if (mode === 'tab') { for (const page of stack) if (!tabRoutes.has(page.route)) page.onUnload?.(); stack.length = 0; }
  else if (mode === 'replace' && stack.length) { const replaced = stack.pop(); if (!tabRoutes.has(replaced.route)) replaced.onUnload?.(); }
  const cached = tabRoutes.has(pathname) ? tabPages.get(pathname) : null;
  current = cached || createPage(pathname, Object.fromEntries(new URLSearchParams(query || '')));
  if (tabRoutes.has(pathname)) tabPages.set(pathname, current);
  stack.push(current); visited.add(pathname); previousSheetId = ''; previousFocusRequestKey = ''; eventKey = ''; pageHost.scrollTop = 0;
  shadow.replaceChildren(); updateNavigation(); render(); restorePagePosition(current);
  if (!cached) current.onLoad?.(pageLoadOptions(current)); current.onShow?.();
  updateLocation(current);
  return browserOperation(options, { errMsg: 'navigateTo:ok' });
}

async function goBack(delta = 1, options = {}) {
  return depart(() => {
    if (stack.length <= 1) return activatePage(routeFor('todo'), '', 'tab', options);
    const count = Math.min(delta, stack.length - 1);
    for (let i = 0; i < count; i++) { const removed = stack.pop(); if (!tabRoutes.has(removed.route)) removed.onUnload?.(); }
    current = stack.at(-1); previousSheetId = ''; previousFocusRequestKey = ''; pageHost.scrollTop = 0; shadow.replaceChildren(); updateNavigation(); render(); restorePagePosition(current); current.onShow?.();
    updateLocation(current);
    return browserOperation(options, { errMsg: 'navigateBack:ok' });
  }, options);
}

function renderInspector() {
  if (!current) return;
  const unique = new Map();
  manifest.pages[current.route].actions.forEach(action => { if (!unique.has(action.handler)) unique.set(action.handler, action); });
  const visible = new Set([...shadow.querySelectorAll('[data-handler]')].flatMap(node => node.dataset.handler.split(' ')));
  const list = document.getElementById('action-list'); list.replaceChildren();
  unique.forEach(action => {
    const seen = performed.has(`${current.route}:${action.handler}`);
    const row = element('div', `action-row${seen ? ' seen' : ''}${visible.has(action.handler) ? ' visible' : ''}`);
    const content = element('div'); content.append(element('code', '', action.handler), element('small', '', seen ? '已操作' : visible.has(action.handler) ? '当前可见' : '条件显示'));
    const label = valueOf(action.label || '', current.data);
    if (label && String(label).trim()) content.append(element('div', 'action-label', String(label).slice(0, 80)));
    const sheetContext = action.conditions?.find(condition => condition.title);
    if (sheetContext) content.append(element('div', 'action-context', `所在面板：${valueOf(sheetContext.title, current.data) || '当前记录的更多操作'}`));
    if (visible.has(action.handler)) {
      const locate = element('button', 'action-locate', '定位操作');
      locate.onclick = () => { const target = [...shadow.querySelectorAll('[data-handler]')].find(node => node.dataset.handler.split(' ').includes(action.handler)); locateBoundAction(target); };
      content.append(locate);
    } else if (action.conditions?.length) {
      const condition = element('details', 'action-condition'); condition.append(element('summary', '', '查看出现条件'));
      action.conditions.forEach(item => condition.append(element('code', '', item.expression === 'Previous conditions do not match' ? '前面的状态条件均不满足' : item.expression)));
      content.append(condition);
    }
    row.append(element('span', 'action-dot'), content); list.append(row);
  });
  const shared = element('details', 'component-actions'); shared.append(element('summary', '', '共享组件操作'));
  for (const [name, component] of Object.entries(manifest.components || {})) {
    const actions = [...new Set(component.actions.map(action => action.handler))];
    if (!actions.length) continue;
    const group = element('div', 'component-action-group'); group.append(element('strong', '', ({ 'app-sheet': '底部操作面板', 'privacy-gate': '隐私授权' })[name] || name));
    actions.forEach(handler => { const isSeen = performed.has(`component:${name}.${handler}`); group.append(element('div', 'action-context', `${({ close: '关闭面板（保存时不可关闭）', stop: '阻止背景滚动', openPolicy: '阅读隐私指引', agree: '同意并继续', reject: '暂不同意' })[handler] || handler}${isSeen ? ' · 已操作' : ''}`)); });
    shared.append(group);
  }
  list.append(shared);
  document.getElementById('action-count').textContent = String(unique.size);
}

async function openPage(route) {
  const owner = current;
  if (!workbenchReady(owner)) return false;
  if (!route.startsWith('pages/')) route = routeFor(route);
  if (route === routeFor('detail')) return workbenchNavigate(`${route}?id=monthly`, 'push', { owner });
  if (route === routeFor('receipt')) return workbenchNavigate(`${route}?activityId=quarterly`, 'push', { owner });
  if (route === routeFor('web-entry')) return workbenchNavigate(`${route}?url=${encodeURIComponent('https://cc.cmbchina.com/promotion/')}`, 'push', { owner });
  if (route === routeFor('progress')) {
    let detail;
    try { detail = await preparationQuery('activity.get', { activityId: 'monthly' }); }
    catch (error) { if (!workbenchReady(owner, false)) return false; throw error; }
    if (!workbenchReady(owner)) return false;
    return workbenchNavigate(`${route}?activityId=monthly&id=${encodeURIComponent(detail.participation.id)}`, 'push', { owner });
  }
  return workbenchNavigate(route, tabRoutes.has(route) ? 'tab' : 'push', { owner });
}

function buildAtlas() {
  const atlas = document.getElementById('page-atlas');
  for (const [label, pages] of atlasGroups) {
    const group = element('div', 'atlas-group'); group.append(element('span', 'atlas-group-label', label));
    for (const [name, title] of pages) {
      const button = element('button', 'atlas-link'); button.dataset.route = routeFor(name); button.append(element('span', 'node'), element('span', '', title));
      button.onclick = () => openPage(routeFor(name)).catch(error => showToast({ title: error.message })); group.append(button);
    }
    atlas.append(group);
  }
}

function buildFlowMap() {
  const flows = [
    ['持有权益', [['entitlements', '查看剩余次数'], ['entitlement-edit', '登记权益与规则'], ['lounges', '查支持银行与准入'], ['entitlements', '回到权益记录／撤销']]],
    ['参与活动', [['activities', '发现活动'], ['detail', '核对规则／加入'], ['todo', '查看待办'], ['progress', '更新进度'], ['receipt', '记录返现／优惠'], ['rewards', '核对收益'], ['history', '回看历史']]],
    ['卡片账单', [['wallet', '查看卡包'], ['card-edit', '添加／编辑卡片'], ['wallet', '调整账单／标记还款'], ['activities', '匹配持卡活动']]],
    ['公开投稿', [['submission-lead', '分享线索'], ['submission-edit', '补充完整规则'], ['submissions', '跟踪审核状态'], ['review', '运营核实／退回'], ['detail', '审核通过后公开']]],
    ['个人设置', [['mine', '我的'], ['preferences', '提醒偏好'], ['web-entry', '外部网页边界']]],
  ];
  const map = document.getElementById('flow-map');
  for (const [label, steps] of flows) {
    const row = element('div', 'flow-line'); row.append(element('strong', 'flow-label', label));
    const track = element('div', 'flow-track');
    steps.forEach(([page, title], index) => {
      if (index) { const arrow = element('span', 'flow-arrow', '→'); arrow.setAttribute('aria-hidden', 'true'); track.append(arrow); }
      const button = element('button', 'flow-node', title); button.onclick = () => (page === 'review' ? scenarios.review() : openPage(page)).catch(error => showToast({ title: error.message })); track.append(button);
    });
    row.append(track); map.append(row);
  }
}

async function seedReview() {
  if (!(await workbenchNavigate(routeFor('review'), 'push', { role: 'moderator' }))) return false;
  const targetPage = current;
  const claim = { roleRevision: demoRoleRevision, sequence: ++reviewScenarioSequence };
  const ownsScenario = () => demoRoleRevision === claim.roleRevision && reviewScenarioSequence === claim.sequence
    && services.demoActor.isModerator === true && workbenchReady(targetPage, false) && !targetPage._leaveMessage;
  try {
    if (!ownsScenario()) return false;
    const existing = await scenarioQuery('submissions.list', { moderation: true, status: 'pending', limit: 50 });
    if (!ownsScenario()) return false;
    if (!existing.items.length) {
      await services.api.command('submission.lead.save', { lead: { title: '周末餐饮返现活动线索（演示）', bankId: 'cmb', sourceUrl: 'https://cc.cmbchina.com/promotion/', sourceNote: '演示投稿：请审核人员核对银行官方规则，尚未公开。', imageIds: [] } });
      if (!ownsScenario()) return false;
      const detail = await scenarioQuery('activity.get', { activityId: 'monthly' });
      if (!ownsScenario()) return false;
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      await services.api.command('submission.save', { draft: { ...draft, title: '消费满三笔返现活动（演示待审核）', sourceNote: '原型演示稿件，来源与入口需运营核实。' } });
    }
    if (!ownsScenario()) return false;
    await reloadPage(targetPage);
    if (!ownsScenario()) return false;
    feedback('已切换为演示运营身份。可核实完整稿、补全线索，或退回补充。不会发布真实活动。');
    return true;
  } catch (error) {
    if (!ownsScenario()) return false;
    throw error;
  }
}

function requestReset() {
  const owner = current;
  if (!workbenchReady(owner)) return false;
  return depart(reset, {}, async () => {
    const result = await showModal({ title: '重置演示记录？', content: '将清除在此原型中填写的卡片、参与记录和草稿，并恢复初始演示数据。', confirmText: '重置', cancelText: '保留记录' });
    return result.confirm;
  }, { canCommit: () => workbenchReady(owner) });
}

async function reset() {
  clearComposition();
  for (const page of new Set([...stack, ...tabPages.values()])) page.onUnload?.(); stack.length = 0; tabPages.clear(); current = null;
  while (platformDialogs.length) platformDialogs.at(-1).close(false);
  resetStorage(); services.resetDemoCache(); await services.setDemoRole('user');
  nextQueryFailure = false; nextCommandFailure = false; refreshReadEffect = null; visited.clear(); performed.clear();
  document.getElementById('platform-layer').replaceChildren();
  await services.demoService(); activatePage(routeFor('todo'), '', 'tab'); feedback('已重置为初始演示记录。');
}

async function seedPagination() {
  if (!(await workbenchNavigate(routeFor('activities'), 'tab'))) return false;
  const targetPage = current;
  if (!workbenchReady(targetPage, false)) return false;
  let roleLease = null;
  try { if (!getStorageSync('scenario.pagination.v1')) {
    const previousRole = services.demoActor.isModerator;
    const roleUpdate = services.setDemoRole('moderator');
    roleLease = { previousRole, revision: demoRoleRevision };
    await roleUpdate;
    if (!workbenchReady(targetPage, false)) return false;
    const detail = await scenarioQuery('activity.get', { activityId: 'monthly' });
    if (!workbenchReady(targetPage, false)) return false;
    const { id, revision, status, publishedAt, updatedAt, publishedBy, ...baseDraft } = detail.activity;
    const session = await scenarioQuery('session.get', {});
    for (let index = 0; index < 32; index++) {
      if (!workbenchReady(targetPage, false)) return false;
      const number = String(index + 1).padStart(2, '0');
      const draft = { ...baseDraft, title: `分页演示活动 ${number}`, sourceNote: '交互原型分页演示资料；不代表真实银行活动。' };
      const submission = await services.api.command('submission.save', { draft });
      if (!workbenchReady(targetPage, false)) return false;
      const activity = await services.api.command('submission.review', { id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft });
      if (!workbenchReady(targetPage, false)) return false;
      const record = await services.api.command('activity.join', { activityId: activity.id });
      if (!workbenchReady(targetPage, false)) return false;
      await services.api.command('reward.confirm', { participationId: record.id, amountMinor: 100 + index, receivedOn: session.today, expectedVersion: record.version });
      if (!workbenchReady(targetPage, false)) return false;
      await services.api.command('submission.lead.save', { lead: { title: `分页演示线索 ${number}`, bankId: 'cmb', sourceUrl: '', sourceNote: '交互原型待审核线索，规则和入口尚需核实。', imageIds: [] } });
      if (!workbenchReady(targetPage, false)) return false;
      feedback(`正在准备分页演示 ${index + 1} / 32，全部数据仅保存在此浏览器。`);
      if (index % 4 === 3) await deferred(0);
    }
    if (!workbenchReady(targetPage, false)) return false;
    setStorageSync('scenario.pagination.v1', true);
  } } finally {
    if (roleLease && demoRoleRevision === roleLease.revision) {
      await services.setDemoRole(roleLease.previousRole ? 'moderator' : 'user');
    }
  }
  if (!workbenchReady(targetPage, false) || targetPage._leaveMessage) return false;
  await reloadPage(targetPage);
  if (!workbenchReady(targetPage, false) || targetPage._leaveMessage) return false;
  feedback('分页场景已准备：活动、收益、历史、投稿及运营审核均有多页记录。点“下次读取失败”，再加载更多可检查局部失败与重试。');
  return true;
}

async function simulateConcurrentEdit() {
  const page = current;
  if (!workbenchReady(page)) return false;
  if (![routeFor('progress'), routeFor('receipt')].includes(page?.route) || !page.data.participation || page.data.loading) {
    feedback('先打开“记录活动进度”或“确认返现到账”表单并填写，再模拟并发修改；输入会保留。'); return;
  }
  const latest = (await scenarioQuery('activity.get', { participationId: page.data.participation.id })).participation;
  if (!workbenchReady(page)) return false;
  if (latest.stage === 'completed') await services.api.command('participation.expected', { participationId: latest.id, expectedOn: latest.expectedOn });
  else if (latest.stage === 'received') await services.api.command('reward.confirm', { participationId: latest.id, amountMinor: latest.receivedMinor, receivedOn: latest.receivedOn, expectedVersion: latest.version });
  else await services.api.command('participation.progress', { participationId: latest.id, progress: latest.progress, registered: !!latest.registeredAt, expectedVersion: latest.version });
  if (!workbenchReady(page, false)) return false;
  feedback('已通过同一业务服务模拟另一端更新。现在保存，将提示版本冲突；读取最新记录后可重新应用保留的输入。');
}

async function describeScenario(action, description) {
  const completed = await action();
  if (completed) feedback(description);
  return completed;
}

const scenarios = {
  entitlements() { return describeScenario(() => openPage('entitlements'), '查看个人登记的权益、剩余次数、有效期和三种转让规则；记录使用可撤销。'); },
  lounges() { return describeScenario(() => openPage('lounges'), '按机场名称、城市或代码查已登记的贵宾厅，优先查看支持银行，再核对预约时间、卡种与客户资格。'); },
  progress() { return describeScenario(() => openPage('progress'), '修改累计进度与报名状态，保存后回到活动详情。'); },
  receipt() { return describeScenario(() => openPage('receipt'), '按实际金额和日期记录返现；到账月份与活动所属期分别保留。'); },
  discount() { return describeScenario(() => workbenchNavigate(`${routeFor('detail')}?id=instant`), '即时立减按“实际优惠”记录，可与返现收益区分查看。'); },
  wallet() { return describeScenario(() => workbenchNavigate(`${routeFor('card-edit')}?id=demo-card-cmb`), '可修改卡片、账单和还款日期，保存后返回卡包查看。'); },
  submit() { return describeScenario(() => workbenchNavigate(routeFor('submission-lead'), 'push', { role: 'user' }), '提供银行、标题与出处即可提交线索；也可继续填写完整规则。'); },
  review: seedReview,
  pagination: seedPagination,
  conflict: simulateConcurrentEdit,
  history() { return describeScenario(() => workbenchNavigate(`${routeFor('history')}?activityId=monthly`), '查看本期与往期记录，展开操作历史可核对每次修改。'); },
  async denied() {
    const owner = current;
    if (!workbenchReady(owner)) return false;
    return describeScenario(() => owner.route === routeFor('review')
      ? depart(async () => {
        void services.setDemoRole('user');
        await reloadPage(owner);
        return current === owner;
      }, {}, undefined, { hide: false, canCommit: () => workbenchReady(owner) })
      : workbenchNavigate(routeFor('review'), 'push', { owner, role: 'user' }),
    '当前为普通演示用户，审核页应显示权限提示。');
  },
};

function buildScenarios() {
  const options = [
    ['entitlements', '速查持有权益', '余额 → 使用记录 → 撤销'], ['lounges', '查机场贵宾厅', '机场 → 支持银行 → 预约／资格'],
    ['progress', '记录活动进度', '报名 → 累计 → 完成'], ['receipt', '确认返现到账', '实际金额 → 到账日期'],
    ['discount', '记录即时优惠', '立减 → 记录 → 更正'], ['wallet', '管理卡片账单', '编辑 → 日期 → 还款'],
    ['submit', '分享活动线索', '草稿 → 提交 → 状态'], ['review', '运营审核投稿', '核实 → 退回／发布'],
    ['history', '回看参与记录', '本期 → 往期 → 操作记录'], ['denied', '查看权限边界', '普通用户 → 无审核权限'],
    ['pagination', '查看分页与重试', '准备多页活动、收益与投稿'],
  ];
  const container = document.getElementById('scenario-list');
  options.forEach(([id, title, detail]) => {
    const button = element('button', 'scenario-button'); button.dataset.scenario = id;
    const copy = element('span'); copy.append(element('strong', '', title), element('small', '', detail)); button.append(element('span', '', '↗'), copy);
    button.onclick = async () => { button.disabled = true; try { await scenarios[id](); } catch (error) { showToast({ title: error.message }); } finally { button.disabled = false; } }; container.append(button);
  });
}

async function privacyScenario() {
  const owner = current;
  if (!workbenchReady(owner)) return false;
  const result = await showModal({ title: '使用前请了解', content: '上传活动入口图片需要使用你选择的照片。个人卡包、进度与收益仅供你查看；投稿内容审核通过后才公开。\n\n此处模拟微信隐私授权流程。', platform: true, policyLink: true, confirmText: '同意并继续', cancelText: '暂不同意' });
  if (current !== owner) return false;
  performed.add(`component:privacy-gate.${result.confirm ? 'agree' : 'reject'}`);
  renderInspector();
  feedback(result.confirm ? '已演示同意隐私授权，可继续选择图片。' : '已演示拒绝授权，当前记录保留，可稍后重新授权。');
}

function sourceOperationPending(owner) {
  const fields = ['saving', 'removing', 'reloading', 'rebasing', 'busy', 'uploading', 'busyId', 'reminderBusyId', 'expectedClosing', 'preparingCards', 'changingRole', 'subscribeBusy', 'openingSubmissions'];
  return fields.some(field => !!owner?.data?.[field]);
}

// Internal reconciliation must retain the page instance that authorized it.
function reloadPage(owner) {
  if (!owner || current !== owner || sourceOperationPending(owner)) return false;
  if (owner.onPullDownRefresh) return invoke(owner, 'onPullDownRefresh');
  if (owner.load) return invoke(owner, 'load');
  const [route, query] = pageUrl(owner).split('?');
  hideCurrentPage(owner);
  return activatePage(route, query, 'replace');
}

async function refreshPage(mode = 'normal') {
  const owner = current;
  if (!owner || owner._prototypeRefreshing) return false;
  if (platformDialogs.length) { feedback('请先完成当前对话框。'); return false; }
  if (sourceOperationPending(owner)) { feedback('请等待当前操作完成后再刷新。'); return false; }
  owner._prototypeRefreshing = true;
  try {
    return await depart(async () => {
      if (sourceOperationPending(owner)) { feedback('请等待当前操作完成后再刷新。'); return false; }
      // Arm one-shot read effects only after the user accepts the refresh.
      const effect = mode === 'slow' ? { owner, delay: 1600 } : mode === 'failure' ? { owner, fail: true } : null;
      if (effect) {
        refreshReadEffect = effect;
        feedback(mode === 'slow' ? '本次读取将延迟约 1.6 秒，可检查加载状态。' : '已模拟本次加载失败，点击页面中的重试恢复。');
      }
      try { return await reloadPage(owner); }
      finally { if (effect && refreshReadEffect === effect) refreshReadEffect = null; }
    }, {}, () => mayLeave(owner, 'refresh'), { hide: false });
  } finally { owner._prototypeRefreshing = false; }
}

async function start(serviceExports) {
  services = serviceExports;
  let moderator = services.demoActor.isModerator;
  // Observe original imported setters too, including explicit same-role choices.
  Object.defineProperty(services.demoActor, 'isModerator', {
    enumerable: true, configurable: true,
    get() { return moderator; },
    set(value) { moderator = value; demoRoleRevision += 1; },
  });
  const rawQuery = services.api.query.bind(services.api);
  const rawCommand = services.api.command.bind(services.api);
  // Read-only route preparation must not consume a user's pending fault fixture.
  preparationQuery = rawQuery;
  const readWithEffects = async (read, applyRefreshEffect) => {
    const effect = applyRefreshEffect && refreshReadEffect?.owner === current ? refreshReadEffect : null;
    if (effect) refreshReadEffect = null;
    const fail = nextQueryFailure || effect?.fail;
    nextQueryFailure = false;
    if (effect?.delay) await deferred(effect.delay);
    if (fail) throw new services.ApiError('NETWORK_ERROR', '演示网络中断，请重试。');
    return read();
  };
  services.api.query = (...args) => readWithEffects(() => rawQuery(...args), true);
  // Workbench setup reads are not part of an editor's accepted refresh.
  scenarioQuery = (...args) => readWithEffects(() => rawQuery(...args), false);
  services.api.command = async (...args) => {
    if (args[2]?.replayOnly === true) return readWithEffects(() => rawCommand(...args), true);
    if (nextCommandFailure) { nextCommandFailure = false; throw new services.ApiError('NETWORK_ERROR', '演示保存失败，填写内容已保留，请重试。'); }
    return rawCommand(...args);
  };
  buildAtlas(); buildScenarios(); buildFlowMap();
  const resize = new ResizeObserver(() => {
    const size = `${pageHost.clientWidth}:${pageHost.clientHeight}`;
    pageHost.style.setProperty('--prototype-rpx', `${pageHost.clientWidth / 750}px`);
    pageHost.style.setProperty('--prototype-vw', `${pageHost.clientWidth / 100}px`);
    pageHost.style.setProperty('--prototype-vh', `${pageHost.clientHeight / 100}px`);
    if (size !== lastViewportSize) { lastViewportSize = size; scheduleRender(); }
  });
  resize.observe(pageHost);
  document.getElementById('native-back').onclick = () => goBack();
  pageHost.addEventListener('scroll', () => {
    if (current?.onReachBottom && pageHost.scrollTop + pageHost.clientHeight >= pageHost.scrollHeight - 48) void invoke(current, 'onReachBottom');
  }, { passive: true });
  document.getElementById('refresh-page').onclick = () => refreshPage();
  document.getElementById('viewport-width').onchange = event => { document.getElementById('device').style.width = `${event.target.value}px`; };
  document.getElementById('reset-prototype').onclick = requestReset;
  document.getElementById('slow-next').onclick = () => refreshPage('slow');
  document.getElementById('fail-next').onclick = () => refreshPage('failure');
  document.getElementById('fail-save').onclick = () => { if (!workbenchReady(current)) return; nextCommandFailure = true; feedback('下一次保存将模拟失败；再次保存可恢复，输入应保留。'); };
  document.getElementById('fail-read').onclick = () => { if (!workbenchReady(current)) return; nextQueryFailure = true; feedback('下一次读取将模拟失败。可继续点击“加载更多”，检查已有内容保留和局部重试。'); };
  document.getElementById('conflict-record').onclick = () => simulateConcurrentEdit().catch(error => showToast({ title: error.message }));
  document.getElementById('privacy-scenario').onclick = privacyScenario;
  const totalBindings = [...Object.values(manifest.pages), ...Object.values(manifest.components)].reduce((sum, page) => sum + page.actions.length, 0);
  document.getElementById('coverage-summary').textContent = `当前构建包含 ${manifest.config.pages.length} 个页面、${Object.keys(manifest.components).length} 个共享组件、${totalBindings} 个操作绑定。弹层关闭、日期选择、对话框取消与恢复草稿均可交互。`;
  if (matchMedia('(max-width:640px)').matches) document.querySelector('.atlas-details').open = false;
  await services.demoService();
  const initial = location.hash.replace(/^#\//, '');
  await navigate(definitions.has(initial.split('?')[0]) ? initial : routeFor('todo'), 'tab');
  window.Prototype.ready = true;
}

window.Prototype = {
  register(route, definition) { definitions.set(route, definition); },
  start, navigate: workbenchNavigate, openPage, reset: requestReset, resetFixture: reset, scenarios, refresh: refreshPage, ready: false,
  get current() { return current; },
  get api() { return services?.api; },
  get shadow() { return shadow; },
  get coverage() { return manifest.pages; },
  get performed() { return [...performed]; },
};
