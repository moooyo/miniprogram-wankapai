import type { Card, Commands, Entitlement, EntitlementDraft, EntitlementKind, LoungeAccess, Transferability } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { cardLabel } from '../../services/card-labels';
import { confirmDraftRecovery, createCommandIntent, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';
import { navigateBackOr } from '../../services/navigation';

type FormDraft = Omit<EntitlementDraft, 'totalUses' | 'initialUsed'> & { totalUses: string; initialUsed: string };
type LoungeForm = Omit<LoungeAccess, 'advanceHours' | 'unitsPerVisit' | 'supportedBanks'> & { advanceHours: string; unitsPerVisit: string; supportedBanksInput: string };
type SavePayload = Commands['entitlement.save'];
type Section = 'basic' | 'quota' | 'transfer' | 'lounges';
interface PendingSave { payload: SavePayload; intentKey: string; }
interface StoredDraft { draft: FormDraft; expectedVersion: number | null; intentKey: string; pending: PendingSave | null; }
interface InputEvent { currentTarget: { dataset: { field: string } }; detail: { value: string }; }
interface FieldEvent { currentTarget: { dataset: { field: string } }; }
const kinds: { value: EntitlementKind; label: string }[] = [{ value: 'lounge', label: '机场贵宾厅' }, { value: 'health_check', label: '体检' }, { value: 'other', label: '其他权益' }];
const transfers: { value: Transferability; label: string }[] = [{ value: 'allowed', label: '明确可转让' }, { value: 'grey', label: '可转让（灰）' }, { value: 'not_allowed', label: '不可转让' }];
const zones: { value: LoungeAccess['zone']; label: string }[] = [{ value: 'unknown', label: '待核实' }, { value: 'domestic', label: '国内出发' }, { value: 'international', label: '国际／港澳台出发' }, { value: 'both', label: '国内及国际' }];
const reservations: { value: LoungeAccess['reservation']; label: string }[] = [{ value: 'unknown', label: '待核实' }, { value: 'required', label: '需要预约' }, { value: 'not_required', label: '无需预约' }];
const customerScopes: { value: LoungeAccess['customerScope']; label: string }[] = [{ value: 'unknown', label: '待核实' }, { value: 'all', label: '符合此权益的所有客户' }, { value: 'local_bank', label: '仅本地银行客户' }, { value: 'specified', label: '仅指定客户' }];
const fieldLabels: Record<string, string> = { title: '权益名称', kind: '权益类型', cardId: '关联卡片', provider: '提供方', totalUses: '总次数', initialUsed: '录入前已使用', startsOn: '生效日期', endsOn: '到期日期', transferability: '转让规则', transferNote: '转让说明', notes: '补充说明', lounges: '可用贵宾厅', airportName: '机场名称', airportCode: '机场三字码', city: '城市', loungeName: '贵宾厅名称', terminal: '航站楼', zone: '出发区域', supportedBanks: '支持的银行', supportedBanksInput: '支持的银行', reservation: '预约要求', advanceHours: '提前预约小时数', reservationNote: '预约说明', customerScope: '适用客户', customerNote: '客户限制说明', guestNote: '同行人规则', openingHours: '营业时间', location: '位置', unitsPerVisit: '每次扣除次数', sourceNote: '规则来源', verifiedOn: '核实日期' };
const mainTextFields = ['title', 'provider', 'notes', 'transferNote', 'totalUses', 'initialUsed', 'startsOn', 'endsOn'];
const loungeTextFields = ['airportName', 'airportCode', 'city', 'loungeName', 'terminal', 'advanceHours', 'reservationNote', 'customerNote', 'guestNote', 'openingHours', 'location', 'unitsPerVisit', 'sourceNote', 'verifiedOn'];
const definiteRejections = new Set(['INVALID_INPUT', 'INVALID_DATE', 'NOT_FOUND', 'CONFLICT', 'IMMUTABLE', 'VERSION_CONFLICT', 'INVALID_STATE', 'FORBIDDEN', 'UNAUTHORIZED', 'CARD_ARCHIVED', 'INSUFFICIENT_USES', 'ENTITLEMENT_ARCHIVED']);

function emptyDraft(kind: EntitlementKind = 'lounge', cardId = '', today = ''): FormDraft {
  return { title: '', kind, cardId, provider: '', totalUses: '', initialUsed: '0', startsOn: today, endsOn: '', transferability: 'not_allowed', transferNote: '', notes: '', lounges: [] };
}
function emptyLounge(): LoungeForm {
  return { id: createCommandIntent(), airportName: '', airportCode: '', city: '', loungeName: '', terminal: '', zone: 'unknown', supportedBanksInput: '', reservation: 'unknown', advanceHours: '0', reservationNote: '', customerScope: 'unknown', customerNote: '', guestNote: '', openingHours: '', location: '', unitsPerVisit: '1', sourceNote: '', verifiedOn: '' };
}
function loungeFormFrom(value: LoungeAccess): LoungeForm {
  const { supportedBanks, ...fields } = value;
  return { ...fields, advanceHours: String(value.advanceHours), unitsPerVisit: String(value.unitsPerVisit), supportedBanksInput: supportedBanks?.join('\n') || '' };
}
function parseSupportedBanks(value: string): string[] {
  return Array.from(new Set(value.split(/[\r\n,，、;；]+/).map(name => name.trim()).filter(Boolean)));
}
function loungeFieldName(field: string): string {
  return /^supportedBanks(?:\.\d+)?$/.test(field) ? 'supportedBanksInput' : field;
}
function formFrom(value: EntitlementDraft): FormDraft {
  return { title: value.title, kind: value.kind, cardId: value.cardId, provider: value.provider, totalUses: String(value.totalUses), initialUsed: String(value.initialUsed), startsOn: value.startsOn, endsOn: value.endsOn, transferability: value.transferability, transferNote: value.transferNote, notes: value.notes, lounges: value.lounges.map(item => ({ ...item })) };
}
function toDraft(value: FormDraft): EntitlementDraft {
  return { ...value, title: value.title.trim(), provider: value.provider.trim(), notes: value.notes.trim(), transferNote: value.transferNote.trim(), totalUses: Number(value.totalUses), initialUsed: Number(value.initialUsed), lounges: value.lounges.map(item => ({ ...item })) };
}
function whole(value: string, minimum: number, maximum = 9999): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validLounge(value: unknown): value is LoungeAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as LoungeAccess;
  return ['id', ...loungeTextFields.filter(field => !['advanceHours', 'unitsPerVisit'].includes(field))].every(field => typeof (item as unknown as Record<string, unknown>)[field] === 'string')
    && zones.some(row => row.value === item.zone) && reservations.some(row => row.value === item.reservation) && customerScopes.some(row => row.value === item.customerScope)
    && (item.supportedBanks === undefined || Array.isArray(item.supportedBanks) && item.supportedBanks.length <= 30 && item.supportedBanks.every(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 120))
    && Number.isSafeInteger(item.advanceHours) && item.advanceHours >= 0 && Number.isSafeInteger(item.unitsPerVisit) && item.unitsPerVisit > 0;
}
function validForm(value: unknown): value is FormDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as FormDraft;
  return [...mainTextFields, 'cardId'].every(field => typeof (item as unknown as Record<string, unknown>)[field] === 'string')
    && kinds.some(row => row.value === item.kind) && transfers.some(row => row.value === item.transferability)
    && Array.isArray(item.lounges) && item.lounges.length <= 30 && item.lounges.every(validLounge);
}
function signature(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(signature).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + signature(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function sectionFor(field: string): Section {
  if (['totalUses', 'initialUsed', 'startsOn', 'endsOn'].includes(field)) return 'quota';
  if (['transferability', 'transferNote', 'notes'].includes(field)) return 'transfer';
  if (field.startsWith('lounges')) return 'lounges';
  return 'basic';
}
function summaryFor(errors: Record<string, string>) {
  return Object.entries(errors).map(([field, message]) => {
    const match = /^lounges\.(\d+)\.(.+)$/.exec(field);
    return { field, message, label: match ? `贵宾厅 ${Number(match[1]) + 1} · ${fieldLabels[loungeFieldName(match[2])] || '使用规则'}` : fieldLabels[loungeFieldName(field)] || '权益信息' };
  });
}
function loungeErrorsFor(form: LoungeForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.airportName.trim()) errors.airportName = '请填写机场名称。';
  if (form.airportCode && !/^[A-Z]{3}$/.test(form.airportCode.trim())) errors.airportCode = '请填写 3 位英文字母，例如 PEK；不确定可以留空。';
  if (!form.loungeName.trim()) errors.loungeName = '请填写贵宾厅名称。';
  const supportedBanks = parseSupportedBanks(form.supportedBanksInput);
  if (supportedBanks.length > 30) errors.supportedBanksInput = '每个贵宾厅最多填写 30 家支持的银行。';
  else if (supportedBanks.some(name => name.length > 120)) errors.supportedBanksInput = '每家银行名称不能超过 120 个字符。';
  if (!whole(form.advanceHours, 0, 720)) errors.advanceHours = '请填写 0 至 720 的整数小时数。';
  if (['local_bank', 'specified'].includes(form.customerScope) && !form.customerNote.trim()) errors.customerNote = '请写明适用银行、地区或具体客户条件。';
  if (!whole(form.unitsPerVisit, 1)) errors.unitsPerVisit = '请填写 1 至 9999 的整数次数。';
  if (form.verifiedOn && !validDate(form.verifiedOn)) errors.verifiedOn = '请选择有效的核实日期。';
  return errors;
}

Page({
  data: {
    id: '', editing: false, initialKind: 'lounge' as EntitlementKind, initialCardId: '', ownerId: '', entityId: '',
    loading: true, ready: false, saving: false, reloading: false, identityChanged: false, conflict: false,
    loadError: '', formError: '', notice: '', today: '', dirty: false, draftSaved: false, pending: false, saved: false,
    draft: emptyDraft(), record: null as Entitlement | null, expectedVersion: null as number | null, baseSignature: '', intentKey: '',
    cards: [] as Card[], cardChoices: [{ id: '', label: '不关联卡片' }], cardIndex: 0, kinds, kindIndex: 0, transfers, transferIndex: 2,
    openSection: 'basic' as Section | '', remaining: '—', trackedUsed: 0, errors: {} as Record<string, string>, errorSummary: [] as ReturnType<typeof summaryFor>, focusField: '',
    loungeRows: [] as { id: string; title: string; location: string; banks: string; reservation: string; customer: string; error: string }[],
    loungeVisible: false, loungeIndex: -1, loungeDraft: null as LoungeForm | null, loungeBase: '', loungeAdvanced: false,
    loungeErrors: {} as Record<string, string>, loungeErrorSummary: [] as ReturnType<typeof summaryFor>, loungeFocus: '', loungeScrollTarget: '',
    zones, reservations, customerScopes, zoneIndex: 0, reservationIndex: 0, customerIndex: 0,
  },
  disposed: false,
  hidden: false,
  loadSequence: 0,
  ownerSequence: 0,
  pendingSave: null as PendingSave | null,
  draftRevision: null as string | null,
  isCurrentPage(): boolean {
    if (this.disposed || this.hidden) return false;
    if (typeof getCurrentPages !== 'function') return true;
    const pages = getCurrentPages();
    return pages.length === 0 || pages[pages.length - 1] === this;
  },
  onLoad(options: Record<string, string | undefined>) {
    const initialKind = kinds.find(item => item.value === options.kind)?.value || 'lounge';
    this.setData({ id: options.id || '', editing: !!options.id, initialKind, initialCardId: options.cardId || '' });
    wx.setNavigationBarTitle({ title: options.id ? '编辑权益' : '添加权益' });
    void this.load();
  },
  onShow() {
    this.hidden = false;
    this.updateLeaveWarning();
    if (this.data.ready) void this.checkOwner();
  },
  onHide() { this.hidden = true; this.ownerSequence++; },
  onUnload() { this.disposed = true; this.loadSequence++; this.ownerSequence++; },
  async checkOwner(): Promise<boolean> {
    const sequence = ++this.ownerSequence;
    try {
      const session = await ensureSession(true);
      if (this.disposed || sequence !== this.ownerSequence) return false;
      if (session.userId !== this.data.ownerId) {
        this.setData({ identityChanged: true, formError: '当前身份已变化，原草稿仍保留。请返回卡包后重新打开。' });
        return false;
      }
      return !this.data.identityChanged;
    } catch {
      if (!this.disposed && sequence === this.ownerSequence) this.setData({ formError: '暂时无法核对当前身份，请稍后重试。填写内容已保留。' });
      return false;
    }
  },
  async load() {
    if (this.disposed || this.data.saving || this.data.reloading || this.data.ready) return;
    const sequence = ++this.loadSequence;
    this.setData({ loading: true, loadError: '' });
    try {
      const session = await ensureSession(true);
      const result = this.data.id ? await api.query('entitlement.get', { id: this.data.id }) : await api.query('entitlements.list', {});
      if (this.disposed || sequence !== this.loadSequence) return;
      const record = 'entitlement' in result ? result.entitlement : null;
      if (record && (record.ownerId !== session.userId || record.archivedAt)) throw new Error('这条权益已归档或不属于当前账号，请返回卡包重新选择。');
      const draft = record ? formFrom(record) : emptyDraft(this.data.initialKind, this.data.initialCardId, result.today);
      this.pendingSave = null;
      this.setData({ ownerId: session.userId, entityId: this.data.id || 'new', record, cards: result.cards,
        draft, today: result.today, expectedVersion: record?.version ?? null, baseSignature: signature(draft),
        intentKey: createCommandIntent(), ready: true, identityChanged: false, conflict: false, dirty: false, draftSaved: false, pending: false });
      this.refreshDerived();
      await this.restoreDraft(sequence);
    } catch (error) {
      if (!this.disposed && sequence === this.loadSequence) this.setData({ loadError: (error as Error).message || '权益资料读取失败，请重试。' });
    } finally {
      if (!this.disposed && sequence === this.loadSequence) { this.setData({ loading: false }); this.updateLeaveWarning(); }
    }
  },
  async restoreDraft(sequence: number) {
    if (!this.isCurrentPage()) return;
    const saved = loadDraft<StoredDraft>('entitlement', this.data.ownerId, this.data.entityId);
    if (!saved) return;
    const revision = getDraftRevision('entitlement', this.data.ownerId, this.data.entityId);
    const value = saved.value;
    const intentValid = typeof value.intentKey === 'string' && value.intentKey.length > 0 && value.intentKey.length <= 128;
    let valid = validForm(value.draft) && intentValid && (value.expectedVersion === null || Number.isInteger(value.expectedVersion) && value.expectedVersion > 0);
    if (valid && value.pending) {
      const payload = value.pending.payload;
      valid = !!payload && value.pending.intentKey === value.intentKey && (payload.id || '') === this.data.id
        && signature(payload.draft) === signature(toDraft(value.draft))
        && (this.data.editing ? payload.expectedVersion === value.expectedVersion : payload.expectedVersion === undefined);
    }
    if (!valid) {
      this.setData({ notice: '本机草稿无法恢复，已保留原副本。请重新填写当前权益。' });
      return;
    }
    const recover = value.pending
      ? !!(await wx.showModal({ title: '上次保存结果待确认', content: '保存可能已经成功。恢复后会使用原操作重试，避免重复添加。放弃草稿不会撤销已发送的保存，请先到卡包核对。', confirmText: '恢复核对', cancelText: '放弃草稿' })).confirm
      : await confirmDraftRecovery(saved, this.data.record?.version ?? null);
    if (this.disposed || this.hidden || sequence !== this.loadSequence) return;
    if (!recover) { removeDraft('entitlement', this.data.ownerId, this.data.entityId, revision); return; }
    this.pendingSave = value.pending || null;
    this.draftRevision = revision;
    this.setData({ draft: value.draft, expectedVersion: value.expectedVersion, intentKey: value.intentKey, pending: !!value.pending,
      conflict: !value.pending && this.data.editing && value.expectedVersion !== this.data.record?.version,
      notice: value.pending ? '上次保存结果尚未确认，请先重试原操作。填写内容暂时锁定。' : '已恢复本机草稿，请核对后保存。' });
    this.refreshDerived();
    this.persistDraft();
  },
  canEdit(): boolean {
    return !this.disposed && !this.hidden && this.data.ready && !this.data.loading && !this.data.saving && !this.data.reloading && !this.data.pending && !this.data.identityChanged && !this.data.saved;
  },
  updateLeaveWarning() {
    if (!this.isCurrentPage()) return;
    const loungeChanged = this.data.loungeVisible && signature(this.data.loungeDraft) !== this.data.loungeBase;
    if (this.data.dirty || this.data.pending || loungeChanged) wx.enableAlertBeforeUnload({ message: loungeChanged ? '贵宾厅修改尚未加入权益，离开后这些修改将丢失。' : this.data.draftSaved ? '权益尚未保存，离开后可恢复本机草稿。' : '权益尚未保存，离开后填写内容可能丢失。' });
    else wx.disableAlertBeforeUnload();
  },
  persistDraft() {
    if (this.disposed || !this.data.ready || this.data.saved || this.data.identityChanged) return;
    const dirty = signature(this.data.draft) !== this.data.baseSignature || !!this.pendingSave;
    if (!dirty) {
      removeDraft('entitlement', this.data.ownerId, this.data.entityId, this.draftRevision);
      this.draftRevision = null;
      this.setData({ dirty: false, draftSaved: false });
    } else {
      const value: StoredDraft = { draft: this.data.draft, expectedVersion: this.data.expectedVersion, intentKey: this.data.intentKey, pending: this.pendingSave };
      const draftSaved = saveDraft('entitlement', this.data.ownerId, this.data.entityId, this.data.expectedVersion, value);
      if (draftSaved) this.draftRevision = getDraftRevision('entitlement', this.data.ownerId, this.data.entityId);
      this.setData({ dirty: true, draftSaved });
    }
    this.updateLeaveWarning();
  },
  refreshDerived() {
    const draft = this.data.draft;
    const trackedUsed = this.data.record ? this.data.record.usedUses - this.data.record.initialUsed : 0;
    const remaining = whole(draft.totalUses, 0) && whole(draft.initialUsed, 0) ? String(Number(draft.totalUses) - Number(draft.initialUsed) - trackedUsed) : '—';
    const cards = this.data.cards.filter(card => !card.archivedAt && card.ownerId === this.data.ownerId);
    const cardChoices = [{ id: '', label: '不关联卡片' }, ...cards.map(card => ({ id: card.id, label: cardLabel(card.id, this.data.cards) }))];
    if (draft.cardId && !cardChoices.some(card => card.id === draft.cardId)) {
      const original = this.data.cards.find(card => card.id === draft.cardId && card.ownerId === this.data.ownerId && card.id === this.data.record?.cardId);
      cardChoices.push({ id: draft.cardId, label: original ? cardLabel(original.id, this.data.cards) : '原关联卡片已不可用，请重新选择' });
    }
    const loungeRows = draft.lounges.map((item, index) => ({ id: item.id, title: item.loungeName,
      location: [item.city, item.airportName, item.airportCode, item.terminal, zones.find(zone => zone.value === item.zone)?.label].filter(Boolean).join(' · '),
      banks: item.supportedBanks?.length ? `支持银行 · ${item.supportedBanks.join('、')}` : '支持银行待核实',
      reservation: item.reservation === 'required' ? `需预约${item.advanceHours ? ` · 至少提前 ${item.advanceHours} 小时` : ''}` : item.reservation === 'not_required' ? '无需预约' : '预约要求待核实',
      customer: item.customerScope === 'unknown' ? '适用客户待核实' : item.customerScope === 'all' ? '符合此权益的所有客户' : `${customerScopes.find(scope => scope.value === item.customerScope)?.label} · ${item.customerNote}`,
      error: Object.entries(this.data.errors).find(([field]) => field.startsWith(`lounges.${index}.`))?.[1] || '',
    }));
    this.setData({ trackedUsed, remaining, cardChoices, cardIndex: Math.max(0, cardChoices.findIndex(card => card.id === draft.cardId)),
      kindIndex: kinds.findIndex(kind => kind.value === draft.kind), transferIndex: transfers.findIndex(item => item.value === draft.transferability), loungeRows });
  },
  changeDraft(patch: Partial<FormDraft>, field: string) {
    const errors = { ...this.data.errors };
    delete errors[field];
    this.setData({ draft: { ...this.data.draft, ...patch }, errors, errorSummary: summaryFor(errors), focusField: '', formError: '' });
    this.refreshDerived();
    this.persistDraft();
  },
  input(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    if (mainTextFields.includes(field)) this.changeDraft({ [field]: event.detail.value }, field);
  },
  select(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field, index = Number(event.detail.value);
    if (field === 'kind' && kinds[index]) this.changeDraft({ kind: kinds[index].value }, field);
    if (field === 'cardId' && this.data.cardChoices[index]) this.changeDraft({ cardId: this.data.cardChoices[index].id }, field);
    if (field === 'transferability' && transfers[index]) this.changeDraft({ transferability: transfers[index].value }, field);
  },
  toggleSection(event: { currentTarget: { dataset: { section: Section } } }) {
    if (!this.canEdit()) return;
    const section = event.currentTarget.dataset.section;
    if (['basic', 'quota', 'transfer', 'lounges'].includes(section)) this.setData({ openSection: this.data.openSection === section ? '' : section });
  },
  openLounge(event: { currentTarget: { dataset: { index?: string | number } } }) {
    if (!this.canEdit()) return;
    const index = event.currentTarget.dataset.index === undefined ? -1 : Number(event.currentTarget.dataset.index);
    if (index === -1 && this.data.draft.lounges.length >= 30) { this.setData({ formError: '每条权益最多可记录 30 个贵宾厅。' }); return; }
    const item = this.data.draft.lounges[index];
    if (index !== -1 && !item) return;
    const loungeDraft = item ? loungeFormFrom(item) : emptyLounge();
    this.setData({ loungeVisible: true, loungeIndex: index, loungeDraft, loungeBase: signature(loungeDraft), loungeAdvanced: false, loungeErrors: {}, loungeErrorSummary: [], loungeFocus: '', loungeScrollTarget: '',
      zoneIndex: zones.findIndex(row => row.value === loungeDraft.zone), reservationIndex: reservations.findIndex(row => row.value === loungeDraft.reservation), customerIndex: customerScopes.findIndex(row => row.value === loungeDraft.customerScope) });
  },
  loungeInput(event: InputEvent) {
    if (!this.canEdit() || !this.data.loungeDraft) return;
    const field = event.currentTarget.dataset.field;
    if (!loungeTextFields.includes(field) && field !== 'supportedBanksInput') return;
    const value = field === 'airportCode' ? event.detail.value.toUpperCase() : event.detail.value;
    const loungeErrors = { ...this.data.loungeErrors }; delete loungeErrors[field];
    this.setData({ loungeDraft: { ...this.data.loungeDraft, [field]: value }, loungeErrors, loungeErrorSummary: summaryFor(loungeErrors) });
    this.updateLeaveWarning();
  },
  loungeSelect(event: InputEvent) {
    if (!this.canEdit() || !this.data.loungeDraft) return;
    const field = event.currentTarget.dataset.field, index = Number(event.detail.value);
    let patch: Partial<LoungeForm> = {};
    if (field === 'zone' && zones[index]) { patch = { zone: zones[index].value }; this.setData({ zoneIndex: index }); }
    if (field === 'reservation' && reservations[index]) { patch = { reservation: reservations[index].value, advanceHours: reservations[index].value === 'required' ? this.data.loungeDraft.advanceHours : '0' }; this.setData({ reservationIndex: index }); }
    if (field === 'customerScope' && customerScopes[index]) { patch = { customerScope: customerScopes[index].value }; this.setData({ customerIndex: index }); }
    this.setData({ loungeDraft: { ...this.data.loungeDraft, ...patch } }); this.updateLeaveWarning();
  },
  toggleLoungeAdvanced() { if (this.canEdit()) this.setData({ loungeAdvanced: !this.data.loungeAdvanced }); },
  clearVerifiedOn() {
    if (!this.canEdit() || !this.data.loungeDraft) return;
    this.loungeInput({ currentTarget: { dataset: { field: 'verifiedOn' } }, detail: { value: '' } });
  },
  async closeLounge() {
    if (!this.canEdit() || !this.data.loungeVisible) return;
    if (signature(this.data.loungeDraft) !== this.data.loungeBase) {
      const result = await wx.showModal({ title: '放弃这次贵宾厅修改？', content: '关闭后，这次填写的贵宾厅内容不会加入权益。', confirmText: '放弃修改', cancelText: '继续填写' });
      if (!result.confirm || !this.canEdit()) return;
    }
    this.setData({ loungeVisible: false, loungeDraft: null }); this.updateLeaveWarning();
  },
  focusLoungeError(event: FieldEvent) {
    if (!this.data.loungeDraft) return;
    const field = loungeFieldName(event.currentTarget.dataset.field);
    const advanced = ['guestNote', 'openingHours', 'location', 'unitsPerVisit', 'sourceNote', 'verifiedOn'].includes(field);
    this.setData({ loungeAdvanced: this.data.loungeAdvanced || advanced, loungeFocus: '', loungeScrollTarget: '' }, () => {
      if (!this.disposed) this.setData({ loungeFocus: field, loungeScrollTarget: `lounge-field-${field}` });
    });
  },
  commitLounge() {
    if (!this.canEdit() || !this.data.loungeDraft) return;
    const form = this.data.loungeDraft, errors = loungeErrorsFor(form);
    if (form.verifiedOn && form.verifiedOn > this.data.today) errors.verifiedOn = '核实日期不能晚于今天。';
    if (Object.keys(errors).length) {
      this.setData({ loungeErrors: errors, loungeErrorSummary: summaryFor(errors) });
      this.focusLoungeError({ currentTarget: { dataset: { field: Object.keys(errors)[0] } } });
      return;
    }
    const { supportedBanksInput, ...fields } = form;
    const lounge: LoungeAccess = { ...fields, supportedBanks: parseSupportedBanks(supportedBanksInput), advanceHours: form.reservation === 'required' ? Number(form.advanceHours) : 0, unitsPerVisit: Number(form.unitsPerVisit) };
    for (const field of loungeTextFields) if (!['advanceHours', 'unitsPerVisit'].includes(field)) (lounge as unknown as Record<string, unknown>)[field] = (form as unknown as Record<string, string>)[field].trim();
    const lounges = this.data.draft.lounges.map(item => ({ ...item }));
    if (this.data.loungeIndex >= 0) lounges[this.data.loungeIndex] = lounge;
    else { if (lounges.length >= 30) return; lounges.push(lounge); }
    const errorsLeft = Object.fromEntries(Object.entries(this.data.errors).filter(([field]) => !field.startsWith('lounges')));
    this.setData({ loungeVisible: false, loungeDraft: null, errors: errorsLeft });
    this.changeDraft({ lounges }, 'lounges');
  },
  async removeLounge() {
    if (!this.canEdit() || this.data.loungeIndex < 0) return;
    const index = this.data.loungeIndex, id = this.data.loungeDraft?.id;
    const answer = await wx.showModal({ title: '移除这个贵宾厅？', content: '将从本条权益的可用贵宾厅中移除，已记录的使用记录会保留。保存权益后生效。', confirmText: '移除', confirmColor: '#ac3737' });
    if (!answer.confirm || !this.canEdit() || this.data.draft.lounges[index]?.id !== id) return;
    this.setData({ loungeVisible: false, loungeDraft: null, errors: Object.fromEntries(Object.entries(this.data.errors).filter(([field]) => !field.startsWith('lounges'))) });
    this.changeDraft({ lounges: this.data.draft.lounges.filter((_, row) => row !== index) }, 'lounges');
  },
  validationErrors(): Record<string, string> {
    const draft = this.data.draft, errors: Record<string, string> = {};
    if (!draft.title.trim()) errors.title = '请填写权益名称。';
    if (draft.cardId && !this.data.cards.some(card => card.id === draft.cardId && (!card.archivedAt || card.id === this.data.record?.cardId) && card.ownerId === this.data.ownerId)) errors.cardId = '请选择仍在卡包中的卡片，或选择不关联卡片。';
    if (!whole(draft.totalUses, 0)) errors.totalUses = '请填写 0 至 9999 的整数总次数。';
    if (!whole(draft.initialUsed, 0)) errors.initialUsed = '请填写 0 至 9999 的整数次数。';
    if (!errors.totalUses && !errors.initialUsed && Number(draft.totalUses) < Number(draft.initialUsed) + this.data.trackedUsed) errors.totalUses = `总次数不能少于已使用的 ${Number(draft.initialUsed) + this.data.trackedUsed} 次。`;
    if (!validDate(draft.startsOn)) errors.startsOn = '请选择生效日期。';
    if (!validDate(draft.endsOn)) errors.endsOn = '请选择到期日期。';
    if (!errors.startsOn && !errors.endsOn && draft.endsOn < draft.startsOn) errors.endsOn = '到期日期不能早于生效日期。';
    if (draft.kind !== 'lounge' && draft.lounges.length) errors.kind = '已有贵宾厅规则。请保留机场贵宾厅类型，或先移除贵宾厅。';
    draft.lounges.forEach((item, index) => {
      const invalid = loungeErrorsFor(loungeFormFrom(item));
      if (item.verifiedOn && item.verifiedOn > this.data.today) invalid.verifiedOn = '核实日期不能晚于今天。';
      Object.entries(invalid).forEach(([field, message]) => { errors[`lounges.${index}.${field === 'supportedBanksInput' ? 'supportedBanks' : field}`] = message; });
    });
    return errors;
  },
  showErrors(errors: Record<string, string>) {
    const errorSummary = summaryFor(errors);
    this.setData({ errors, errorSummary, focusField: '' }); this.refreshDerived();
    if (!this.isCurrentPage()) return;
    if (errorSummary.length > 1) wx.pageScrollTo({ selector: '#entitlement-errors', duration: 180 });
    else if (errorSummary[0]) this.focusError({ currentTarget: { dataset: { field: errorSummary[0].field } } });
  },
  focusError(event: FieldEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    const match = /^lounges\.(\d+)\.(.+)$/.exec(field);
    this.setData({ openSection: sectionFor(field), focusField: '' }, () => {
      if (!this.isCurrentPage()) return;
      if (match) {
        this.openLounge({ currentTarget: { dataset: { index: Number(match[1]) } } });
        const loungeField = loungeFieldName(match[2]);
        const loungeErrors = { [loungeField]: this.data.errors[field] || '请检查此项。' };
        this.setData({ loungeErrors, loungeErrorSummary: summaryFor(loungeErrors) });
        this.focusLoungeError({ currentTarget: { dataset: { field: loungeField } } });
      } else if (fieldLabels[field]) {
        wx.pageScrollTo({ selector: `#field-${field}`, duration: 180 });
        this.setData({ focusField: field });
      }
    });
  },
  async reloadLatest() {
    if (this.disposed || this.data.saving || this.data.reloading || this.data.pending || !this.data.id) return;
    this.setData({ reloading: true, formError: '' });
    try {
      if (!await this.checkOwner()) return;
      const result = await api.query('entitlement.get', { id: this.data.id });
      if (this.disposed) return;
      if (result.entitlement.ownerId !== this.data.ownerId || result.entitlement.archivedAt) throw new Error('这条权益已归档或不属于当前账号，请返回卡包重新选择。');
      this.setData({ record: result.entitlement, cards: result.cards, today: result.today, expectedVersion: result.entitlement.version,
        baseSignature: signature(formFrom(result.entitlement)), conflict: false, notice: '已读取最新记录，当前填写内容已保留。请核对次数、有效期和规则后再次保存。' });
      this.refreshDerived(); this.persistDraft();
    } catch (error) {
      if (!this.disposed) this.setData({ formError: (error as Error).message || '最新记录读取失败，填写内容已保留。' });
    } finally { if (!this.disposed) this.setData({ reloading: false }); }
  },
  async save() {
    if (this.disposed || this.hidden || !this.data.ready || this.data.loading || this.data.saving || this.data.reloading || this.data.identityChanged || this.data.conflict || this.data.loungeVisible || this.data.saved) return;
    if (!this.pendingSave) {
      const errors = this.validationErrors(); this.showErrors(errors);
      if (Object.keys(errors).length) return;
    }
    this.setData({ saving: true, formError: '' });
    let revision: string | null = null;
    const ownerId = this.data.ownerId, entityId = this.data.entityId;
    try {
      if (!await this.checkOwner() || this.disposed || this.hidden) return;
      const pending = this.pendingSave || { payload: { ...(this.data.id ? { id: this.data.id, expectedVersion: this.data.expectedVersion! } : {}), draft: toDraft(this.data.draft) }, intentKey: this.data.intentKey };
      this.pendingSave = pending;
      this.setData({ pending: true }); this.persistDraft();
      revision = getDraftRevision('entitlement', ownerId, entityId);
      if (pending.payload.id) await api.command('entitlement.save', pending.payload);
      else await api.command('entitlement.save', pending.payload, { intentKey: pending.intentKey });
      removeDraft('entitlement', ownerId, entityId, revision);
      if (this.disposed) return;
      this.pendingSave = null;
      this.setData({ saved: true, pending: false, dirty: false, draftSaved: false, notice: '权益已保存。' });
      this.updateLeaveWarning();
      if (this.isCurrentPage() && await this.checkOwner() && this.isCurrentPage()) {
        wx.showToast({ title: '权益已保存', icon: 'success' }); navigateBackOr('/pages/wallet/index', true);
      }
    } catch (error) {
      if (this.disposed) return;
      const failure = error as { code?: string; field?: string; message?: string };
      if (failure.code && definiteRejections.has(failure.code)) {
        this.pendingSave = null;
        this.setData({ pending: false, conflict: failure.code === 'VERSION_CONFLICT' });
        if (getDraftRevision('entitlement', ownerId, entityId) === revision) this.persistDraft();
      }
      const field = failure.field?.replace(/^draft\./, '').replace(/\[(\d+)\]/g, '.$1');
      if (field && (fieldLabels[field] || /^lounges\.\d+\.[a-zA-Z]+(?:\.\d+)?$/.test(field))) this.showErrors({ [field]: failure.message || '请检查此项。' });
      this.setData({ formError: failure.code === 'VERSION_CONFLICT' ? '这条权益已有更新。请读取最新记录，填写内容会保留。' : this.data.pending ? '保存结果暂未确认。请重试原操作，避免重复添加；填写内容已保留。' : failure.message || '保存失败，请稍后重试。填写内容已保留。' });
    } finally {
      if (!this.disposed) {
        this.setData({ saving: false });
        if (!this.data.pending && this.data.errorSummary.length && !this.data.saved) this.showErrors(this.data.errors);
      }
    }
  },
  back() { if (!this.data.saving && !this.data.reloading) navigateBackOr('/pages/wallet/index', true); },
});
