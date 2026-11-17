import { z } from 'zod';
import type { PLATFORMS } from './publish.js';

const secret = z.string().trim().min(8).max(2048);

export const credentialSchemas = {
  youtube: z.strictObject({ clientId: secret, clientSecret: secret, refreshToken: secret }),
  instagram: z.strictObject({ accessToken: secret, userId: z.string().regex(/^[0-9]{5,30}$/) }),
  tiktok: z.strictObject({ accessToken: secret, openId: secret }),
} as const;

export const credentialFileSchema = z.strictObject({
  entries: z
    .record(z.string().max(80), z.record(z.string().max(40), z.string().max(2048)))
    .default({}),
});

export type CredentialFile = z.infer<typeof credentialFileSchema>;
export type CredentialData<P extends (typeof PLATFORMS)[number]> = z.infer<
  (typeof credentialSchemas)[P]
>;
