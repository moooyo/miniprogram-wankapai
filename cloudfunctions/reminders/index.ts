import cloud from 'wx-server-sdk';
import { createService } from '../../domain/service';
import { CloudDatabase, CloudStore } from '../shared/cloud-store';
import { readReminderConfiguration } from './configuration';
import { createReminderWorker, SubscriptionMessage } from './worker';

// The SDK runtime accepts its dynamic-environment symbol; the published init type omits it.
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

export async function main() {
  const context = cloud.getWXContext();
  if (context.SOURCE !== 'wx_trigger') return { ok: false, error: { code: 'FORBIDDEN', message: '仅允许定时触发器调用' } };
  const store = new CloudStore(cloud.database({ throwOnNotFound: false } as Parameters<typeof cloud.database>[0]) as unknown as CloudDatabase);
  const service = createService(store);
  const configuration = readReminderConfiguration(process.env);
  const send = (message: SubscriptionMessage) => cloud.openapi.subscribeMessage.send(message);
  try {
    const result = await createReminderWorker({
      store, configuration, send,
      materialize: async ownerId => { await service.execute({ userId: ownerId, isModerator: false }, { action: 'dashboard.get', payload: {} }); },
    })();
    return { ok: true, data: { ...result, configurationIssues: configuration.issues } };
  } catch {
    console.error(JSON.stringify({ code: 'REMINDER_WORKER_FAILED' }));
    return { ok: false, error: { code: 'REMINDER_WORKER_FAILED', message: '提醒任务暂未完成，请查看任务状态' } };
  }
}
