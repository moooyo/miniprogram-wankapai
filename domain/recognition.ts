import { ActivityDraft, Asset, AssetRecognition, RecognitionRegion } from '../shared/contracts';
import { DomainError, requireValue } from './errors';
import { validateRecognitionFields } from './validation';

export function normalizeRecognition(items: AssetRecognition[], assets: Asset[]): AssetRecognition[] {
  requireValue(Array.isArray(items) && items.length === assets.length, 'OCR_INVALID_RESULT', '截图识别结果无效，请稍后重试');
  const byId = new Map(items.map(item => [item?.assetId, item]));
  requireValue(byId.size === assets.length && assets.every(asset => byId.has(asset.id)), 'OCR_INVALID_RESULT', '截图识别结果与图片不匹配');
  return assets.map(asset => {
    const result = byId.get(asset.id)!;
    let fields: Partial<ActivityDraft>;
    try { fields = validateRecognitionFields(result.fields); }
    catch { throw new DomainError('OCR_INVALID_RESULT', '截图识别结果无效，请稍后重试'); }
    requireValue(Array.isArray(result.regions) && result.regions.length <= 40, 'OCR_INVALID_RESULT', '截图识别位置无效');
    const regions: RecognitionRegion[] = result.regions.map(region => {
      requireValue(region && typeof region.field === 'string' && region.field.length <= 40 && typeof region.label === 'string' && region.label.length <= 40,
        'OCR_INVALID_RESULT', '截图识别位置无效');
      for (const key of ['x', 'y', 'width', 'height'] as const) requireValue(typeof region[key] === 'number' && Number.isFinite(region[key]) && region[key] >= 0 && region[key] <= 1,
        'OCR_INVALID_RESULT', '截图识别位置无效');
      requireValue(region.width > 0 && region.height > 0 && region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001,
        'OCR_INVALID_RESULT', '截图识别位置超出图片');
      return { field: region.field, label: region.label, x: region.x, y: region.y, width: region.width, height: region.height };
    });
    return { assetId: asset.id, fields, regions, recognized: Object.keys(fields).length > 0 };
  });
}

// This fixture is available only when the authenticated session explicitly uses demo mode.
export function demoRecognition(assets: Asset[]): AssetRecognition[] {
  return assets.map((asset, index) => ({
    assetId: asset.id,
    fields: index === 0 ? {
      bankId: 'cmb', title: '月度消费达标礼', rewardKind: 'cashback', rewardMinor: 1800, currency: 'CNY',
      cycle: { t: 'month', day: 21 }, startsOn: '2026-07-01', endsOn: '2026-12-31',
      conditions: '每期完成 3 笔指定消费，每笔满 100 元。',
      entrance: { kind: 'guide', label: '查看活动入口', instructions: '掌上生活 App → 我的 → 活动中心 → 月度消费达标礼', imageIds: [] },
    } : {},
    regions: index === 0 ? [
      { field: 'title', label: '名称 · 奖励', x: 0.08, y: 0.12, width: 0.84, height: 0.22 },
      { field: 'startsOn', label: '时间', x: 0.08, y: 0.37, width: 0.84, height: 0.11 },
      { field: 'cycle', label: '规则 · 周期', x: 0.08, y: 0.52, width: 0.84, height: 0.2 },
      { field: 'entrance', label: '入口', x: 0.08, y: 0.77, width: 0.84, height: 0.12 },
    ] : [],
    recognized: index === 0,
  }));
}
