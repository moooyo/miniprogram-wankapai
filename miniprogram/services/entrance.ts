import type { Entrance } from '../../shared/contracts';
import { validatePublicHttps } from '../../domain/validation';
import settings from '../runtime-config';

export interface EntranceConfiguration {
  webViewEnabled: boolean;
  allowedWebViewHosts: readonly string[];
}

export type EntranceBehavior = 'miniprogram' | 'webview' | 'clipboard' | 'guide';

export function resolveWebViewUrl(value: unknown, configuration: Readonly<EntranceConfiguration> = settings): string | null {
  if (!configuration.webViewEnabled) return null;
  let url: string;
  try { url = validatePublicHttps(value); } catch { return null; }
  const authority = /^https:\/\/([a-z0-9.-]+)(?::(\d{1,5}))?([/?#].*)?$/i.exec(url);
  if (!authority || (authority[2] !== undefined && Number(authority[2]) !== 443)) return null;
  const host = authority[1].toLowerCase();
  if (!configuration.allowedWebViewHosts.some(allowed => allowed.toLowerCase() === host)) return null;
  // Keep path, query, and fragment bytes intact while removing the default HTTPS port.
  return `https://${host}${authority[3] || ''}`;
}

export function entranceBehavior(entrance: Entrance, configuration: Readonly<EntranceConfiguration> = settings): EntranceBehavior {
  if (entrance.kind === 'miniprogram') return 'miniprogram';
  if (entrance.kind !== 'web' || !entrance.url) return 'guide';
  return resolveWebViewUrl(entrance.url, configuration) ? 'webview' : 'clipboard';
}

export function entranceActionLabel(entrance: Entrance, purpose: 'activity' | 'source' = 'activity', configuration: Readonly<EntranceConfiguration> = settings): string {
  const behavior = entranceBehavior(entrance, configuration);
  if (behavior === 'webview') return purpose === 'source' ? '打开银行规则' : '打开网页';
  if (behavior === 'clipboard') return purpose === 'source' ? '复制银行规则链接' : '复制链接';
  return behavior === 'miniprogram' ? '打开小程序' : '查看指引';
}
