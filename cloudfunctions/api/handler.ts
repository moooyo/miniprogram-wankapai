import { Actor, ApiEnvelope, ApiRequest, Asset } from '../../shared/contracts';
import { DomainError, requireValue } from '../../domain/errors';
import { Store, ServiceOptions } from '../../domain/store';
import { createService } from '../../domain/service';
import { authorizedAssetUrls, CloudStorage } from '../shared/assets';

export interface TrustedContext { OPENID?: string; ENV?: string; SOURCE?: string; }
export interface ApiDependencies {
  store: Store;
  storage: CloudStorage;
  context: () => TrustedContext;
  moderatorOpenIds: string[];
  options?: ServiceOptions;
  report?: (code: string) => void;
}

export function createApiHandler(dependencies: ApiDependencies) {
  return async (event: unknown): Promise<ApiEnvelope<unknown>> => {
    try {
      const context = dependencies.context();
      requireValue(context.OPENID && context.SOURCE === 'wx_client', 'UNAUTHENTICATED', '请通过微信小程序登录');
      const actor: Actor = { userId: context.OPENID, isModerator: dependencies.moderatorOpenIds.includes(context.OPENID) };
      requireValue(event && typeof event === 'object' && !Array.isArray(event), 'INVALID_INPUT', '请求参数无效');
      const request = event as ApiRequest;
      const validator = dependencies.options?.validateAsset;
      let verification: ReturnType<NonNullable<ServiceOptions['validateAsset']>> | undefined;
      const service = createService(dependencies.store, {
        ...dependencies.options,
        ...(validator ? { validateAsset: (owner: Actor, payload: Parameters<typeof validator>[1]) => verification ||= validator(owner, payload) } : {}),
      });
      if (request.action === 'assets.urls') {
        const assets = await service.execute(actor, { action: 'assets.get', payload: request.payload }) as Asset[];
        return { ok: true, data: await authorizedAssetUrls(dependencies.storage, assets) };
      }
      return { ok: true, data: await service.execute(actor, request) };
    } catch (error) {
      if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) } };
      dependencies.report?.('INTERNAL_ERROR');
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } };
    }
  };
}
