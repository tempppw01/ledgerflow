import { z } from 'zod';
import { tApiError as t } from '../../../shared/lib/apiErrorTranslator';
import { parseConnectionString } from './connectionString';

const poolSchema = z.object({
  min: z.coerce.number().int().min(0).max(50),
  max: z.coerce.number().int().min(1).max(100),
  idleTimeoutMs: z.coerce.number().int().min(1000).max(120000)
});

const tlsSchema = z.object({
  enabled: z.boolean(),
  rejectUnauthorized: z.boolean(),
  caCert: z.string().optional()
});

export const connectionFormSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(2, t('dbSettings.connection.error.nameMin', '名称至少 2 个字符')),
    type: z.enum(['redis', 'mysql']),
    host: z.string().min(1, t('dbSettings.connection.error.hostRequired', '主机必填')),
    port: z.coerce.number().int().min(1, t('dbSettings.connection.error.portRange', '端口必须在 1-65535')).max(65535, t('dbSettings.connection.error.portRange', '端口必须在 1-65535')),
    username: z.string().optional(),
    password: z.string().optional(),
    database: z.string().optional(),
    connectionString: z.string().optional(),
    enabled: z.boolean(),
    timeoutMs: z.coerce.number().int().min(1000).max(60000),
    pool: poolSchema,
    tls: tlsSchema
  })
  .superRefine((value, ctx) => {
    if (value.pool.min > value.pool.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pool', 'min'],
        message: t('dbSettings.connection.error.poolMinMax', 'pool.min 不能大于 pool.max')
      });
    }

    if (value.connectionString?.trim()) {
      const parsed = parseConnectionString(value.connectionString, value.type);
      if (!parsed.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectionString'],
          message: parsed.error
        });
      }
      return;
    }

    if (!value.database) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['database'], message: t('dbSettings.connection.error.databaseRequired', '数据库名必填') });
    }
  });

export type ConnectionFormValues = z.infer<typeof connectionFormSchema>;
