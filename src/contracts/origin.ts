import { z } from 'zod';

export const originSchema = z.strictObject({
  url: z.url().max(2048),
});

export type Origin = z.infer<typeof originSchema>;
