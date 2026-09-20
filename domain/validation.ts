import { ActivityDraft, Entrance } from '../shared/contracts';
import { assertDate } from './calendar';
import { DomainError } from './errors';
import { banks, issuers } from '../shared/catalog';

type InputObject = Record<string, unknown>;

function fail(field: string, message: string): never { throw new DomainError('INVALID_INPUT', message, field); }

function object(value: unknown, field: string): InputObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, '请填写完整活动资料');
  return value as InputObject;
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== 'string') fail(field, '请填写有效文字');
  const output = value.trim();
  if (required && !output) fail(field, '此项不能为空');
  if (output.length > max) fail(field, `此项不能超过 ${max} 个字符`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(output)) fail(field, '文字中包含无效字符');
  return output;
}

function choice<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(field, '请选择有效选项');
  return value as T;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field, '请选择有效选项');
  return value;
}

function integer(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(field, `请填写 ${min} 至 ${max} 之间的整数`);
  return value;
}

function targetValue(value: unknown, unit: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000000) fail('target', '活动门槛应大于 0 且不超过 100000000');
  if (['元', '港元', '澳门元'].includes(unit)) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) fail('target', '金额门槛最多支持两位小数');
  } else if (!Number.isInteger(value)) {
    fail('target', '次数和笔数门槛必须为整数');
  }
  return value;
}

function id(value: unknown, field: string): string {
  const output = text(value, field, 128, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(output)) fail(field, '标识无效');
  return output;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(field, `最多可选择 ${max} 项`);
  return value;
}

export function validatePublicHttps(value: unknown, field = 'sourceUrl', required = true): string {
  const url = text(value, field, 2048, required);
  if (!url && !required) return '';
  if (/[\s\\]/.test(url)) fail(field, '请填写完整的 HTTPS 公开网页地址');
  const match = /^https:\/\/([^/?#]+)(?:[/?#].*)?$/i.exec(url);
  if (!match || match[1].includes('@')) fail(field, '仅支持不含账号密码的 HTTPS 公开网页地址');
  const authority = match[1];
  const hostMatch = /^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hostMatch) fail(field, '请使用公开网站域名');
  const host = hostMatch[1].toLowerCase();
  const port = hostMatch[2] === undefined ? 443 : Number(hostMatch[2]);
  if (port < 1 || port > 65535 || host.length > 253 || host.endsWith('.') || !host.includes('.')) fail(field, '请使用公开网站域名');
  const labels = host.split('.');
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail(field, '网页域名无效');
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]) && !/^xn--[a-z0-9-]+$/.test(labels[labels.length - 1])) fail(field, '请使用公开网站域名');
  const reserved = ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'test', 'invalid', 'example', 'onion'];
  if (labels.some(label => label === 'localhost') || reserved.includes(labels[labels.length - 1]) || /(^|\.)example\.(com|org|net)$/.test(host)) {
    fail(field, '请使用真实的公开网页地址');
  }
  return url;
}

function validateEntrance(value: unknown, publish: boolean): Entrance {
  const source = object(value, 'entrance');
  const kind = choice(source.kind, ['guide', 'web', 'miniprogram'] as const, 'entrance.kind');
  const label = text(source.label, 'entrance.label', 40, publish);
  const instructions = text(source.instructions, 'entrance.instructions', 2000);
  const imageIds = list(source.imageIds, 'entrance.imageIds', 6).map(value => id(value, 'entrance.imageIds'));
  if (new Set(imageIds).size !== imageIds.length) fail('entrance.imageIds', '请移除重复图片');
  const entrance: Entrance = { kind, label, instructions, imageIds };
  if (source.url !== undefined) entrance.url = validatePublicHttps(source.url, 'entrance.url', false);
  if (source.appId !== undefined) {
    entrance.appId = text(source.appId, 'entrance.appId', 18);
    if (entrance.appId && !/^wx[a-f0-9]{16}$/.test(entrance.appId)) fail('entrance.appId', '请填写有效的小程序 AppID');
  }
  if (source.path !== undefined) {
    entrance.path = text(source.path, 'entrance.path', 1024);
    if (entrance.path && (/^[a-z][a-z0-9+.-]*:/i.test(entrance.path) || entrance.path.startsWith('//') || /[\s\\]/.test(entrance.path))) {
      fail('entrance.path', '请填写小程序内的页面路径');
    }
  }
  if (source.shortLink !== undefined) {
    entrance.shortLink = text(source.shortLink, 'entrance.shortLink', 1024);
    if (entrance.shortLink && !/^#小程序:\/\/[^/\r\n\t]{1,100}\/[A-Za-z0-9_-]{1,256}$/.test(entrance.shortLink)) {
      fail('entrance.shortLink', '请粘贴微信生成的完整小程序短链接');
    }
  }
  if (publish) {
    if (kind === 'web' && !entrance.url) fail('entrance.url', '请填写活动入口地址');
    if (kind === 'miniprogram' && !entrance.appId && !entrance.shortLink) fail('entrance.appId', '请填写小程序 AppID 或短链接');
    if (kind === 'guide' && !instructions && imageIds.length === 0) fail('entrance.instructions', '请填写操作路径或添加入口图片');
  }
  return entrance;
}

export function validateDraft(input: unknown, publish = false): ActivityDraft {
  const source = object(input, 'draft');
  const startsOn = assertDate(source.startsOn, 'startsOn');
  const endsOn = assertDate(source.endsOn, 'endsOn');
  if (endsOn < startsOn) fail('endsOn', '结束日期不能早于开始日期');
  const issuerIds = list(source.issuerIds, 'issuerIds', 40).map(value => id(value, 'issuerIds'));
  if (new Set(issuerIds).size !== issuerIds.length) fail('issuerIds', '发卡机构不能重复');
  const bankId = id(source.bankId, 'bankId');
  if (!banks.some(bank => bank.id === bankId)) fail('bankId', '请选择有效银行');
  if (issuerIds.some(issuerId => !issuers.some(issuer => issuer.id === issuerId && issuer.bankId === bankId))) fail('issuerIds', '发卡机构与银行不匹配');
  const networks = list(source.networks, 'networks', 5).map(value => choice(value, ['visa', 'mastercard', 'unionpay', 'amex', 'other'] as const, 'networks'));
  if (new Set(networks).size !== networks.length) fail('networks', '卡组织不能重复');
  const unit = text(source.unit, 'unit', 16, true);
  const sourceUrl = validatePublicHttps(source.sourceUrl, 'sourceUrl', false);
  const sourceNote = text(source.sourceNote, 'sourceNote', 500);
  if (!sourceUrl && !sourceNote) fail('sourceUrl', '请填写来源链接或银行 App 内的来源路径');
  return {
    title: text(source.title, 'title', 80, true),
    bankId,
    issuerIds,
    networks,
    cardKind: choice(source.cardKind, ['credit', 'debit', 'any'] as const, 'cardKind'),
    cardDescription: text(source.cardDescription, 'cardDescription', 200),
    frequency: choice(source.frequency, ['once', 'monthly', 'quarterly', 'yearly'] as const, 'frequency'),
    startsOn,
    endsOn,
    target: targetValue(source.target, unit),
    unit,
    currency: choice(source.currency, ['CNY', 'HKD', 'MOP'] as const, 'currency'),
    rewardMinor: integer(source.rewardMinor, 0, 100000000000, 'rewardMinor'),
    rewardKind: choice(source.rewardKind, ['cashback', 'discount'] as const, 'rewardKind'),
    scope: choice(source.scope, ['user', 'card'] as const, 'scope'),
    requiresRegistration: boolean(source.requiresRegistration, 'requiresRegistration'),
    requiresInvitation: boolean(source.requiresInvitation, 'requiresInvitation'),
    conditions: text(source.conditions, 'conditions', 4000, publish),
    sourceUrl,
    sourceNote,
    entrance: validateEntrance(source.entrance, publish)
  };
}
