import { request } from 'node:https';
import { Actor, Asset, AssetRecognition } from '../../shared/contracts';
import { DomainError, requireValue } from '../../domain/errors';
import { validatePublicHttps } from '../../domain/validation';
import { authorizedAssetUrls, CloudStorage } from './assets';

export interface RecognitionProviderRequest { assets: { id: string; url: string; mime: string }[]; locale: 'zh-CN'; }
export type RecognitionTransport = (endpoint: string, token: string, payload: RecognitionProviderRequest) => Promise<{ items: AssetRecognition[] }>;

function sendRequest(endpoint: string, token: string, payload: RecognitionProviderRequest): Promise<{ items: AssetRecognition[] }> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = request(endpoint, {
      method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(new DomainError('OCR_UNAVAILABLE', '截图识别服务暂不可用，请稍后重试')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { response.destroy(); req.destroy(); reject(new DomainError('OCR_INVALID_RESULT', '截图识别结果过大')); }
        else chunks.push(chunk);
      });
      response.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new DomainError('OCR_INVALID_RESULT', '截图识别结果无效')); }
      });
      response.once('error', reject);
    });
    req.once('timeout', () => req.destroy(new DomainError('OCR_UNAVAILABLE', '截图识别超时，请稍后重试')));
    req.once('error', reject);
    req.end(body);
  });
}

// The configured provider returns the normalized fields and 0..1 image regions contract.
export function createAssetRecognizer(storage: CloudStorage, environment: Record<string, string | undefined>, transport: RecognitionTransport = sendRequest) {
  return async (_actor: Actor, assets: Asset[]): Promise<AssetRecognition[]> => {
    const endpoint = environment.OCR_ENDPOINT || '';
    requireValue(endpoint, 'OCR_UNAVAILABLE', '截图识别服务尚未配置，请手动填写活动信息');
    try { validatePublicHttps(endpoint, 'OCR_ENDPOINT'); }
    catch { throw new DomainError('OCR_UNAVAILABLE', '截图识别服务配置无效，请手动填写活动信息'); }
    const urls = await authorizedAssetUrls(storage, assets);
    requireValue(urls.length === assets.length, 'OCR_UNAVAILABLE', '无法读取截图，请重新上传');
    const byId = new Map(urls.map(item => [item.id, item.url]));
    try {
      const result = await transport(endpoint, environment.OCR_TOKEN || '', { assets: assets.map(asset => ({ id: asset.id, url: byId.get(asset.id)!, mime: asset.mime })), locale: 'zh-CN' });
      requireValue(result && Array.isArray(result.items), 'OCR_INVALID_RESULT', '截图识别结果无效');
      return result.items;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('OCR_UNAVAILABLE', '截图识别服务暂不可用，请稍后重试');
    }
  };
}
