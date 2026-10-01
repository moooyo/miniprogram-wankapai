import cloud from 'wx-server-sdk';
import { CloudDatabase, CloudStore } from '../shared/cloud-store';
import { CloudStorage, createAssetValidator } from '../shared/assets';
import { createApiHandler } from './handler';
import { readReminderConfiguration } from '../reminders/configuration';
import { createAssetRecognizer } from '../shared/recognition';

// The SDK runtime accepts its dynamic-environment symbol; the published init type omits it.
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

export async function main(event: unknown) {
  const context = cloud.getWXContext();
  const configuration = readReminderConfiguration(process.env);
  return createApiHandler({
    store: new CloudStore(cloud.database({ throwOnNotFound: false } as Parameters<typeof cloud.database>[0]) as unknown as CloudDatabase),
    storage: cloud as unknown as CloudStorage,
    context: () => context,
    moderatorOpenIds: (process.env.MODERATOR_OPENIDS || '').split(',').map(value => value.trim()).filter(Boolean),
    options: {
      templateIds: configuration.templateIds,
      validateAsset: createAssetValidator(cloud as unknown as CloudStorage, context.ENV || ''),
      recognizeAssets: createAssetRecognizer(cloud as unknown as CloudStorage, process.env),
    },
    report: code => console.error(JSON.stringify({ code })),
  })(event);
}
