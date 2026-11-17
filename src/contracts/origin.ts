import { z } from 'zod';

export const originSchema = z.strictObject({
  url: z.url().max(2048),
  offset: z.number().min(0).default(0),
});

export type Origin = z.infer<typeof originSchema>;
