import { ReminderJob } from '../../shared/contracts';

export type ReminderKind = ReminderJob['kind'];
export interface ReminderTemplate {
  templateId: string;
  fields: Record<string, 'title' | 'dueOn' | 'kindLabel'>;
}
export interface ReminderConfiguration {
  enabled: boolean;
  templates: Partial<Record<ReminderKind, ReminderTemplate>>;
  templateIds: Partial<Record<ReminderKind, string>>;
  issues: string[];
}

export function readReminderConfiguration(environment: Record<string, string | undefined>): ReminderConfiguration {
  const result: ReminderConfiguration = { enabled: environment.REMINDERS_ENABLED === 'true', templates: {}, templateIds: {}, issues: [] };
  if (!environment.REMINDER_TEMPLATES_JSON) return result;
  try {
    const supplied = JSON.parse(environment.REMINDER_TEMPLATES_JSON);
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Invalid object');
    for (const kind of ['new_activity', 'deadline', 'reward', 'repayment'] as const) {
      const item = supplied[kind];
      if (!item) continue;
      const fields = item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields) ? Object.entries(item.fields) : [];
      if (typeof item.templateId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(item.templateId) || !fields.length || fields.length > 5 || fields.some(([key, value]) => !/^(thing|date|time)\d+$/.test(key) || !['title', 'dueOn', 'kindLabel'].includes(String(value)) || ((key.startsWith('date') || key.startsWith('time')) && value !== 'dueOn'))) {
        result.issues.push(`INVALID_TEMPLATE_${kind.toUpperCase()}`);
        continue;
      }
      result.templates[kind] = { templateId: item.templateId, fields: Object.fromEntries(fields) as ReminderTemplate['fields'] };
      result.templateIds[kind] = item.templateId;
    }
  } catch { result.issues.push('INVALID_TEMPLATE_CONFIGURATION'); }
  return result;
}
