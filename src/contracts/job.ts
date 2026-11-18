import { z } from 'zod';
import { ACCOUNT_REF_PATTERN } from './cuts.js';

export const PRESET_IDS = [
  'gameplay-camera',
  'react',
  'filmes',
  'series',
  'filmes-cena',
  'series-cena',
  'podcast',
] as const;

export const PLATFORM_IDS = ['twitch', 'kick', 'youtube'] as const;

const link = z.url().max(2048);
const seconds = z.number().min(0).max(864_000);

export const percentRectSchema = z
  .strictObject({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    w: z.number().gt(0).max(100),
    h: z.number().gt(0).max(100),
  })
  .refine((rect) => rect.x + rect.w <= 100.01 && rect.y + rect.h <= 100.01, {
    message: 'o retângulo passa da borda do vídeo',
  });

export const sourceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('file'), uploadId: z.uuid() }),
  z.strictObject({ type: z.literal('youtube'), url: link }),
  z.strictObject({
    type: z.literal('vod'),
    platform: z.enum(PLATFORM_IDS),
    url: link,
    from: seconds.optional(),
    to: seconds.optional(),
  }),
  z.strictObject({ type: z.literal('live'), platform: z.enum(PLATFORM_IDS), url: link }),
]);

export const bottomSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('default') }),
  z.strictObject({ type: z.literal('source') }),
  z.strictObject({ type: z.literal('url'), url: link }),
  z.strictObject({ type: z.literal('file'), uploadId: z.uuid() }),
]);

export const targetsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('count'), count: z.number().int().min(1).max(20) }),
  z
    .strictObject({
      mode: z.literal('duration'),
      minSeconds: z.number().min(10).max(180),
      maxSeconds: z.number().min(10).max(180),
    })
    .refine((value) => value.maxSeconds >= value.minSeconds, {
      message: 'a duração máxima é menor que a mínima',
    }),
]);

export const selectorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('api'),
    keyId: z.uuid(),
    model: z.string().trim().min(1).max(100).optional(),
  }),
  z.strictObject({
    kind: z.literal('ollama'),
    model: z.string().trim().min(1).max(100),
    baseUrl: z.string().max(300).optional(),
  }),
  z.strictObject({ kind: z.literal('agent'), agent: z.enum(['claude', 'codex']) }),
  z.strictObject({ kind: z.literal('rules') }),
]);

export const jobRequestSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120).optional(),
    preset: z.enum(PRESET_IDS),
    source: sourceSchema,
    targets: targetsSchema,
    selector: selectorSchema,
    accounts: z.array(z.string().regex(ACCOUNT_REF_PATTERN)).max(20).optional(),
    camera: percentRectSchema.optional(),
    bottom: bottomSchema.optional(),
    resume: z.uuid().optional(),
    together: z.boolean().optional(),
  })
  .superRefine((request, context) => {
    const live = request.source.type === 'live';
    if (!live && request.selector.kind === 'rules') {
      context.addIssue({
        code: 'custom',
        path: ['selector'],
        message: 'para um vídeo, escolha API, IA local ou o agente',
      });
    }
    if (live && request.selector.kind === 'agent') {
      context.addIssue({
        code: 'custom',
        path: ['selector'],
        message: 'a live roda sozinha: use regras, API ou IA local',
      });
    }
    const { source } = request;
    if (source.type === 'vod' && source.from !== undefined && source.to !== undefined) {
      if (source.to <= source.from) {
        context.addIssue({
          code: 'custom',
          path: ['source', 'to'],
          message: 'o fim vem antes do início',
        });
      }
    }
  });

export const batchRequestSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120).optional(),
    preset: z.enum(PRESET_IDS),
    targets: targetsSchema,
    selector: selectorSchema,
    mode: z.enum(['queue', 'together']).default('queue'),
    bottom: bottomSchema.optional(),
    items: z
      .array(
        z.strictObject({
          account: z.string().regex(ACCOUNT_REF_PATTERN).nullable(),
          videos: z
            .array(z.strictObject({ source: sourceSchema, selector: selectorSchema.optional() }))
            .min(1)
            .max(50),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((batch, context) => {
    const selectors = [
      batch.selector,
      ...batch.items.flatMap((item) => item.videos.map((video) => video.selector)),
    ];
    if (selectors.some((selector) => selector?.kind === 'agent')) {
      context.addIssue({
        code: 'custom',
        path: ['selector'],
        message: 'a fila roda sozinha: use API ou IA local',
      });
    }
    const total = batch.items.reduce((sum, item) => sum + item.videos.length, 0);
    if (total > 100) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'no máximo 100 vídeos por fila',
      });
    }
  });

export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type PresetId = (typeof PRESET_IDS)[number];
export type PlatformId = (typeof PLATFORM_IDS)[number];
export type PercentRect = z.infer<typeof percentRectSchema>;
export type JobSource = z.infer<typeof sourceSchema>;
export type JobTargets = z.infer<typeof targetsSchema>;
export type JobSelector = z.infer<typeof selectorSchema>;
export type JobRequest = z.infer<typeof jobRequestSchema>;
export type JobBottom = z.infer<typeof bottomSchema>;
