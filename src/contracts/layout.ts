import { z } from 'zod';

export const layoutSchema = z.strictObject({
  camera: z.string().trim().min(1).max(100).optional(),
  cameraSize: z.number().min(10).max(100).optional(),
  bottom: z.enum(['video', 'source']).optional(),
  bottomArea: z.string().trim().min(1).max(100).optional(),
  frame: z.enum(['split', 'fit']).optional(),
});

export type Layout = z.infer<typeof layoutSchema>;
