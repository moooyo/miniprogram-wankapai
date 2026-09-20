import { createHash } from 'node:crypto';
import { get as httpsGet } from 'node:https';
import { Actor, Asset, Commands } from '../../shared/contracts';
import { DomainError, requireValue } from '../../domain/errors';

export interface CloudStorage {
  uploadFile(input: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  getTempFileURL(input: { fileList: { fileID: string; maxAge: number }[] }): Promise<{ fileList: { fileID: string; status: number; tempFileURL?: string }[] }>;
}

export function downloadBoundedImage(url: string, requestFactory: typeof httpsGet = httpsGet): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) return reject(new DomainError('INVALID_ASSET', '图片地址无效'));
    const limit = 5 * 1024 * 1024;
    const request = requestFactory(url, { timeout: 10_000, headers: { 'Accept-Encoding': 'identity' } }, response => {
      if (response.statusCode !== 200 || Number(response.headers['content-length'] || 0) > limit || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.destroy();
        reject(new DomainError('INVALID_ASSET', '图片大小或响应格式无效'));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          response.destroy();
          request.destroy();
          reject(new DomainError('INVALID_ASSET', '图片超过 5 MB'));
        } else chunks.push(chunk);
      });
      response.once('end', () => resolve(Buffer.concat(chunks, size)));
      response.once('error', reject);
    });
    request.once('timeout', () => request.destroy(new Error('Image request timed out')));
    request.once('error', reject);
  });
}

function imageMime(content: Buffer): string | null {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (content.length >= 12 && content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createAssetValidator(storage: CloudStorage, environment: string, download: (url: string) => Promise<Buffer> = downloadBoundedImage) {
  return async (actor: Actor, payload: Commands['asset.register']): Promise<Pick<Asset, 'fileId' | 'cloudPath' | 'size' | 'mime'>> => {
    requireValue(environment && environment !== 'local', 'ENVIRONMENT_UNAVAILABLE', '云环境尚未配置');
    const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(payload.fileId);
    const extension = payload.cloudPath.split('.').pop() || '';
    const allowed: Record<string, string[]> = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
    requireValue(/^[A-Za-z0-9_-]+$/.test(actor.userId) && /^[A-Za-z0-9_-]{1,80}$/.test(payload.id), 'INVALID_ASSET', '图片标识无效');
    requireValue(allowed[payload.mime]?.includes(extension), 'INVALID_ASSET', '图片格式无效');
    requireValue(payload.cloudPath === `uploads/${actor.userId}/${payload.id}.${extension}`, 'INVALID_ASSET', '图片上传位置无效');
    requireValue(match && match[1].startsWith(`${environment}.`) && match[2] === payload.cloudPath && !/[?#%\\]/.test(payload.fileId), 'INVALID_ASSET', '图片不属于当前云环境');
    let content: Buffer;
    try {
      const result = await storage.getTempFileURL({ fileList: [{ fileID: payload.fileId, maxAge: 60 }] });
      const file = result.fileList.find(item => item.fileID === payload.fileId && item.status === 0 && item.tempFileURL?.startsWith('https://'));
      requireValue(file?.tempFileURL, 'INVALID_ASSET', '无法读取上传图片');
      content = await download(file.tempFileURL);
    }
    catch { throw new DomainError('INVALID_ASSET', '无法读取上传图片，请重新上传'); }
    requireValue(Buffer.isBuffer(content) && content.length > 0 && content.length <= 5 * 1024 * 1024 && content.length === payload.size, 'INVALID_ASSET', '图片大小不符或超过 5 MB');
    requireValue(imageMime(content) === payload.mime, 'INVALID_ASSET', '图片内容与格式不符');
    const digest = createHash('sha256').update(content).digest('hex');
    const cloudPath = `sealed/${actor.userId}/${payload.id}/${digest}.${extension}`;
    const sealed = await storage.uploadFile({ cloudPath, fileContent: content });
    requireValue(sealed.fileID.startsWith(`cloud://${environment}.`) && sealed.fileID.endsWith(`/${cloudPath}`), 'INVALID_ASSET', '图片封存失败，请重试');
    return { fileId: sealed.fileID, cloudPath, size: content.length, mime: payload.mime };
  };
}

export async function authorizedAssetUrls(storage: CloudStorage, assets: Asset[]): Promise<{ id: string; url: string }[]> {
  if (!assets.length) return [];
  const result = await storage.getTempFileURL({ fileList: assets.map(asset => ({ fileID: asset.fileId, maxAge: 300 })) });
  const urls = new Map(result.fileList.filter(file => file.status === 0 && file.tempFileURL?.startsWith('https://')).map(file => [file.fileID, file.tempFileURL!]));
  return assets.flatMap(asset => urls.has(asset.fileId) ? [{ id: asset.id, url: urls.get(asset.fileId)! }] : []);
}
