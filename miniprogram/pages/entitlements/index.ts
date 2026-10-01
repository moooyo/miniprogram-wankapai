import type { Commands, Entitlement, EntitlementDetail, EntitlementList, EntitlementUsage } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { banks } from '../../../shared/catalog';
import { EntitlementRow, EntitlementScope, countedEntitlement, currentEntitlement, entitlementRow, filterEntitlements, greyTransferQualification, remainingUses, reservationLabel, customerScopeLabel, validateUsage } from '../../services/entitlement-view';

type ValueEvent = { detail: { value: string } };
type ActionEvent = { currentTarget: { dataset: { id?: string; value?: string } } };
type SheetMode = '' | 'use' | 'history';
type UsageRow = EntitlementUsage & { reversed: boolean };
type BenefitRow = EntitlementRow & { logo: string; bankShort: string; endsLabel: string; meter: { index: number; available: boolean }[] };

function messageOf(error: unknown): string { return error instanceof Error ? error.message : '暂时无法完成操作，请重试。'; }
function codeOf(error: unknown): string { return (error as { code?: string } | null)?.code || ''; }

Page({
  data: {
    loading: true, refreshing: false, failed: false, outdated: false, refreshError: '', demo: false, ownerId: '',
    raw: null as EntitlementList | null, rows: [] as BenefitRow[], totalCount: 0, validCount: 0, archivedCount: 0,
    scope: 'valid' as EntitlementScope, kind: 'all', search: '', filtered: false, expandedId: '',
    scopes: [{ value: 'valid', label: '当前可用' }, { value: 'all', label: '全部权益' }, { value: 'archived', label: '已归档' }],
    kinds: [{ value: 'all', label: '全部' }, { value: 'lounge', label: '贵宾厅' }, { value: 'delay_insurance', label: '延误险' }, { value: 'airport_transfer', label: '接送机' }, { value: 'health_check', label: '体检' }, { value: 'car_wash', label: '洗车' }, { value: 'points', label: '积分' }, { value: 'other', label: '其他' }],
    sheet: '' as SheetMode, selectedId: '', selected: null as Entitlement | null, selectedRow: null as EntitlementRow | null,
    selectedFresh: false, formInitialized: false, detailLoading: false, detailError: '', usages: [] as UsageRow[],
    quantityInput: '1', usedOn: '', note: '', loungeIndex: 0, loungeNames: [] as string[], loungeIds: [] as string[],
    loungeRestriction: '', loungeCost: 0, quantityError: '', dateError: '', formError: '', remainingAfter: 0,
    dirty: false, confirming: false, busy: false, busyUsageId: '', pendingUse: false, status: '',
    greyQualification: greyTransferQualification,
  },
  loadVersion: 0,
  detailVersion: 0,
  disposed: false,
  initialLoungeId: '',
  routeRecord: null as { id: string; loungeId: string } | null,
  pendingUsePayload: null as Commands['entitlement.use'] | null,

  onLoad(options: { id?: string; loungeId?: string; record?: string }) {
    if (options.id && options.record === '1') this.routeRecord = { id: options.id, loungeId: options.loungeId || '' };
    else if (options.id) this.setData({ expandedId: options.id, scope: 'all' });
  },
  async onShow() {
    if (this.data.busy || this.data.confirming || this.data.pendingUse) return;
    if (await this.load() && this.data.sheet && this.data.selected) await this.refreshSelected();
  },
  onUnload() { this.disposed = true; this.loadVersion += 1; this.detailVersion += 1; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },

  async load(): Promise<boolean> {
    if (this.disposed || this.data.confirming || this.data.pendingUse) return false;
    const version = ++this.loadVersion;
    this.setData({ loading: !this.data.raw, refreshing: !!this.data.raw, failed: false, refreshError: '' });
    try {
      const session = await ensureSession();
      const raw = await api.query('entitlements.list', {});
      if (this.disposed || version !== this.loadVersion) return false;
      if (raw.items.some(item => item.ownerId !== session.userId)) throw new Error('账号已变化，请重新读取权益。');
      if (this.data.ownerId && this.data.ownerId !== session.userId) this.resetSheet();
      this.setData({ raw, ownerId: session.userId, demo: session.demo, outdated: false,
        totalCount: raw.items.filter(item => !item.archivedAt).length,
        archivedCount: raw.items.filter(item => !!item.archivedAt).length,
        validCount: raw.items.filter(item => currentEntitlement(item, raw.today)).length });
      this.applyFilters();
      return true;
    } catch (error) {
      if (!this.disposed && version === this.loadVersion) {
        this.setData({ outdated: !!this.data.raw, failed: !this.data.raw,
          refreshError: this.data.raw ? '权益尚未更新，以下为上次读取的记录。请刷新成功后再修改。' : messageOf(error), selectedFresh: false });
      }
      return false;
    } finally {
      if (!this.disposed && version === this.loadVersion) {
        this.setData({ loading: false, refreshing: false });
        if (this.routeRecord && !this.data.failed && !this.data.outdated) {
          const target = this.routeRecord;
          this.routeRecord = null;
          void this.openSelection(target.id, 'use', target.loungeId);
        }
      }
    }
  },
  applyFilters() {
    const raw = this.data.raw;
    if (!raw) return;
    this.setData({ rows: filterEntitlements(raw.items, raw.today, this.data.scope, this.data.kind, this.data.search).map(item => {
      const card = raw.cards.find(value => value.id === item.cardId), bank = banks.find(value => value.id === card?.bankId);
      return { ...entitlementRow(item, raw.cards, raw.today), logo: bank?.logo || '', bankShort: bank?.shortName || '', endsLabel: item.endsOn,
        meter: Array.from({ length: Math.min(item.totalUses, 12) }, (_, index) => ({ index, available: index < Math.ceil((item.totalUses - item.usedUses) / item.totalUses * Math.min(item.totalUses, 12)) })) };
    }),
      filtered: this.data.kind !== 'all' || !!this.data.search.trim() });
  },
  changeScope(event: ActionEvent) {
    if (this.data.busy || this.data.confirming) return;
    const scope = event.currentTarget.dataset.value as EntitlementScope;
    if (!['valid', 'all', 'archived'].includes(scope)) return;
    this.setData({ scope }); this.applyFilters();
  },
  changeKind(event: ActionEvent) {
    if (this.data.busy || this.data.confirming) return;
    this.setData({ kind: event.currentTarget.dataset.value || 'all' }); this.applyFilters();
  },
  changeSearch(event: ValueEvent) { if (!this.data.busy) { this.setData({ search: event.detail.value }); this.applyFilters(); } },
  clearFilters() { this.setData({ kind: 'all', search: '' }); this.applyFilters(); },
  showAll() { this.setData({ scope: 'all', kind: 'all', search: '' }); this.applyFilters(); },
  toggleInfo(event: ActionEvent) {
    if (this.data.busy || this.data.confirming || this.data.detailLoading || this.data.pendingUse) return;
    const id = event.currentTarget.dataset.id || '';
    if (this.data.raw?.items.some(item => item.id === id)) this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  addEntitlement() { if (!this.data.busy && !this.data.confirming) wx.navigateTo({ url: '/pages/entitlement-edit/index' }); },
  editEntitlement(event: ActionEvent) {
    if (!this.canModify()) return;
    const item = this.data.raw?.items.find(value => value.id === event.currentTarget.dataset.id);
    if (!item || item.archivedAt) return;
    wx.navigateTo({ url: `/pages/entitlement-edit/index?id=${encodeURIComponent(item.id)}` });
  },
  openLounges(event: ActionEvent) {
    if (this.data.busy || this.data.confirming) return;
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/lounges/index${id ? `?entitlementId=${encodeURIComponent(id)}` : ''}` });
  },
  canModify(): boolean {
    return !this.disposed && !this.data.loading && !this.data.refreshing && !this.data.outdated && !this.data.failed && !this.data.busy && !this.data.detailLoading && !this.data.confirming && !this.data.pendingUse;
  },
  async recordUse(event: ActionEvent) { if (this.canModify()) await this.openSelection(event.currentTarget.dataset.id || '', 'use'); },
  async openHistory(event: ActionEvent) {
    if (!this.data.busy && !this.data.confirming && !this.data.detailLoading) await this.openSelection(event.currentTarget.dataset.id || '', 'history');
  },
  async openSelection(id: string, sheet: SheetMode, loungeId = '') {
    if (!id || this.disposed || this.data.busy || this.data.detailLoading || this.data.confirming || this.data.pendingUse) return;
    const item = this.data.raw?.items.find(value => value.id === id);
    if (sheet === 'use' && item && (!countedEntitlement(item) || !currentEntitlement(item, this.data.raw!.today))) {
      this.setData({ status: '这项权益当前不可用。可以查看使用记录，或编辑权益资料。' }); return;
    }
    this.pendingUsePayload = null;
    this.initialLoungeId = loungeId;
    this.setData({ sheet, selectedId: id, selected: item || null, selectedRow: item && this.data.raw ? entitlementRow(item, this.data.raw.cards, this.data.raw.today) : null,
      selectedFresh: false, formInitialized: false, detailError: '', formError: '', quantityError: '', dateError: '', usages: [], dirty: false, pendingUse: false,
      quantityInput: '1', usedOn: this.data.raw?.today || '', note: '', loungeIndex: 0, loungeIds: [], loungeNames: [], loungeRestriction: '', loungeCost: 0 });
    await this.readSelected(id, false, loungeId);
  },
  applySelected(detail: EntitlementDetail, preserveInput: boolean, loungeId = '') {
    const item = detail.entitlement;
    const loungeIds = ['', ...item.lounges.map(value => value.id)];
    const selectedLoungeId = preserveInput ? this.data.loungeIds[this.data.loungeIndex] || '' : loungeId;
    const loungeIndex = Math.max(0, loungeIds.indexOf(selectedLoungeId));
    const lounge = item.lounges.find(value => value.id === loungeIds[loungeIndex]);
    this.setData({ selected: item, selectedRow: entitlementRow(item, detail.cards, detail.today), selectedFresh: true, formInitialized: true,
      usages: detail.usages.map(usage => ({ ...usage, reversed: !!usage.reversedAt })),
      loungeIds, loungeNames: ['不指定贵宾厅', ...item.lounges.map(value => `${value.airportName} · ${value.loungeName}`)], loungeIndex,
      ...(preserveInput ? {} : { quantityInput: String(lounge?.unitsPerVisit || 1), usedOn: detail.today < item.startsOn ? item.startsOn : detail.today > item.endsOn ? item.endsOn : detail.today, note: '' }) });
    if (this.data.raw) {
      const exists = this.data.raw.items.some(value => value.id === item.id);
      this.setData({ raw: { ...this.data.raw, today: detail.today, cards: detail.cards,
        items: exists ? this.data.raw.items.map(value => value.id === item.id ? item : value) : [...this.data.raw.items, item] } });
      this.setData({ totalCount: this.data.raw!.items.filter(value => !value.archivedAt).length,
        archivedCount: this.data.raw!.items.filter(value => !!value.archivedAt).length,
        validCount: this.data.raw!.items.filter(value => currentEntitlement(value, detail.today)).length });
      this.applyFilters();
    }
    this.updatePreview();
  },
  async readSelected(id: string, preserveInput: boolean, loungeId = ''): Promise<boolean> {
    const version = ++this.detailVersion;
    this.setData({ detailLoading: true, selectedFresh: false, detailError: '' });
    try {
      const session = await ensureSession();
      const detail = await api.query('entitlement.get', { id });
      if (this.disposed || version !== this.detailVersion || !this.data.sheet) return false;
      if (session.userId !== this.data.ownerId || detail.entitlement.id !== id || detail.entitlement.ownerId !== session.userId || detail.usages.some(usage => usage.ownerId !== session.userId || usage.entitlementId !== id)) {
        throw new Error('账号或权益记录已变化，请返回后重新打开。');
      }
      this.applySelected(detail, preserveInput, loungeId);
      return true;
    } catch (error) {
      if (!this.disposed && version === this.detailVersion) this.setData({ selectedFresh: false, detailError: messageOf(error) });
      return false;
    } finally { if (!this.disposed && version === this.detailVersion) this.setData({ detailLoading: false }); }
  },
  async refreshSelected() {
    if (!this.data.selectedId || this.data.busy || this.data.detailLoading || this.data.confirming || this.data.pendingUse) return;
    if (this.data.outdated && !await this.load()) return;
    if (this.data.selectedId) await this.readSelected(this.data.selectedId, this.data.formInitialized || this.data.dirty, this.initialLoungeId);
  },
  updatePreview() {
    const item = this.data.selected;
    if (!item) return;
    const lounge = item.lounges.find(value => value.id === this.data.loungeIds[this.data.loungeIndex]);
    const quantity = Number(this.data.quantityInput);
    this.setData({ remainingAfter: Number.isSafeInteger(quantity) && quantity > 0 ? remainingUses(item) - quantity : remainingUses(item),
      loungeCost: lounge?.unitsPerVisit || 0,
      loungeRestriction: lounge ? `${reservationLabel(lounge)}；${customerScopeLabel(lounge)}${lounge.customerNote ? `：${lounge.customerNote}` : ''}` : '' });
  },
  markDirty() {
    this.setData({ dirty: true, formError: '' });
    wx.enableAlertBeforeUnload({ message: '使用记录尚未保存，离开后填写内容会丢失。' });
  },
  canEditUsage(): boolean { return this.data.formInitialized && !this.data.busy && !this.data.detailLoading && !this.data.confirming && !this.data.pendingUse; },
  changeQuantity(event: ValueEvent) {
    if (!this.canEditUsage()) return;
    this.setData({ quantityInput: event.detail.value, quantityError: '' }); this.markDirty(); this.updatePreview();
  },
  changeDate(event: ValueEvent) { if (this.canEditUsage()) { this.setData({ usedOn: event.detail.value, dateError: '' }); this.markDirty(); } },
  changeNote(event: ValueEvent) { if (this.canEditUsage()) { this.setData({ note: event.detail.value }); this.markDirty(); } },
  changeLounge(event: ValueEvent) {
    if (!this.canEditUsage() || !this.data.selected) return;
    const loungeIndex = Number(event.detail.value);
    const lounge = this.data.selected.lounges.find(value => value.id === this.data.loungeIds[loungeIndex]);
    this.setData({ loungeIndex, quantityInput: String(lounge?.unitsPerVisit || 1), quantityError: '' }); this.markDirty(); this.updatePreview();
  },
  async closeSheet() {
    if (this.data.busy || this.data.confirming || this.data.detailLoading) return;
    if (this.data.pendingUse) {
      this.setData({ formError: '本次提交结果尚未确认。请先点击“重试确认本次记录”，确认后再关闭。' }); return;
    }
    if (this.data.dirty) {
      this.setData({ confirming: true });
      try {
        const result = await wx.showModal({ title: '放弃未保存的记录？', content: '填写的次数、日期和备注尚未保存，关闭后将丢失。', confirmText: '放弃填写', cancelText: '继续填写' });
        if (!result.confirm || this.disposed) return;
      } finally { if (!this.disposed) this.setData({ confirming: false }); }
    }
    this.resetSheet();
  },
  resetSheet() {
    this.detailVersion += 1;
    this.pendingUsePayload = null;
    this.setData({ sheet: '', selectedId: '', selected: null, selectedRow: null, selectedFresh: false, formInitialized: false, dirty: false, pendingUse: false, detailLoading: false, confirming: false });
    wx.disableAlertBeforeUnload();
  },
  async submitUsage() {
    const item = this.data.selected, raw = this.data.raw;
    if (!item || !raw || this.disposed || this.data.busy || this.data.confirming || this.data.detailLoading) return;
    if (!this.data.pendingUse && (!this.data.selectedFresh || this.data.outdated || this.data.refreshing || !countedEntitlement(item) || !currentEntitlement(item, raw.today))) return;
    const values = validateUsage(item, raw.today, this.data.quantityInput, this.data.usedOn);
    if (!this.data.pendingUse && (values.quantityError || values.dateError)) {
      this.setData({ quantityError: values.quantityError, dateError: values.dateError }); return;
    }
    const payload: Commands['entitlement.use'] = this.pendingUsePayload || {
      id: item.id, quantity: values.quantity, usedOn: this.data.usedOn, note: this.data.note.trim(),
      loungeId: this.data.loungeIds[this.data.loungeIndex] || '', expectedVersion: item.version,
    };
    const ownerId = this.data.ownerId;
    this.setData({ busy: true, formError: '', quantityError: '', dateError: '' });
    try {
      await api.command('entitlement.use', payload);
      if (this.disposed || ownerId !== this.data.ownerId) return;
      this.pendingUsePayload = null;
      this.setData({ status: `已记录「${item.title}」使用 ${payload.quantity} 次（${payload.usedOn}）。可在使用记录中查看或撤销。`, pendingUse: false });
      this.resetSheet();
      await this.load();
    } catch (error) {
      if (this.disposed) return;
      if (codeOf(error) === 'NETWORK_ERROR') {
        this.pendingUsePayload = payload;
        this.setData({ pendingUse: true, dirty: true, formError: '提交结果暂时无法确认。已保留本次内容，请重试确认；不会另建一笔记录。' });
        wx.enableAlertBeforeUnload({ message: '本次使用记录的提交结果尚未确认，请先重试确认。' });
      } else {
        this.pendingUsePayload = null;
        this.setData({ pendingUse: false });
        if (codeOf(error) === 'VERSION_CONFLICT') {
          const refreshed = await this.readSelected(item.id, true);
          this.setData({ formError: refreshed ? '权益已更新，已读取最新余额。你的填写内容仍然保留，请核对后再保存。' : '权益已更新。你的填写内容仍然保留，请读取最新记录后再保存。' });
        } else this.setData({ formError: messageOf(error) });
      }
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  async undoUsage(event: ActionEvent) {
    const item = this.data.selected, id = event.currentTarget.dataset.id;
    const usage = this.data.usages.find(value => value.id === id);
    if (!item || !countedEntitlement(item) || !usage || usage.reversed || !this.canModify() || !this.data.selectedFresh) return;
    this.setData({ confirming: true });
    let confirmed = false;
    try {
      confirmed = (await wx.showModal({ title: '撤销这笔使用记录？', content: `将恢复 ${usage.quantity} 次额度，并保留已撤销记录。`, confirmText: '确认撤销', cancelText: '保留记录' })).confirm;
    } finally { if (!this.disposed) this.setData({ confirming: false }); }
    if (!confirmed || this.disposed) return;
    this.setData({ busy: true, busyUsageId: usage.id, formError: '' });
    try {
      await api.command('entitlement.undo', { id: usage.id, expectedVersion: item.version });
      if (this.disposed) return;
      this.setData({ status: `已撤销 ${usage.usedOn} 的 ${usage.quantity} 次使用，原记录继续保留。` });
      await this.readSelected(item.id, true);
      await this.load();
    } catch (error) {
      if (this.disposed) return;
      if (codeOf(error) === 'VERSION_CONFLICT') {
        await this.readSelected(item.id, true);
        this.setData({ formError: '权益已更新，请核对最新使用记录，再决定是否撤销。' });
      } else this.setData({ formError: messageOf(error) });
    } finally { if (!this.disposed) this.setData({ busy: false, busyUsageId: '' }); }
  },
  async toggleArchive(event: ActionEvent) {
    const item = this.data.raw?.items.find(value => value.id === event.currentTarget.dataset.id);
    if (!item || !this.canModify()) return;
    const archived = !item.archivedAt;
    this.setData({ confirming: true });
    let confirmed = false;
    try {
      confirmed = (await wx.showModal({ title: archived ? '归档这项权益？' : '恢复这项权益？',
        content: archived ? '归档后移入“已归档”，使用记录和剩余次数会保留，之后可以恢复。' : '恢复后将按有效期与剩余次数显示，原使用记录会保留。',
        confirmText: archived ? '归档权益' : '恢复权益', cancelText: '取消' })).confirm;
    } finally { if (!this.disposed) this.setData({ confirming: false }); }
    if (!confirmed || this.disposed) return;
    this.setData({ busy: true });
    try {
      await api.command('entitlement.archive', { id: item.id, archived, expectedVersion: item.version });
      if (this.disposed) return;
      this.setData({ status: `已${archived ? '归档' : '恢复'}「${item.title}」，使用记录已保留。` });
      await this.load();
    } catch (error) {
      if (this.disposed) return;
      this.setData({ status: codeOf(error) === 'VERSION_CONFLICT' ? '权益已更新，请核对最新记录后再操作。' : messageOf(error) });
      if (codeOf(error) === 'VERSION_CONFLICT') await this.load();
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
});
