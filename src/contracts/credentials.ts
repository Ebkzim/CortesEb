import { z } from 'zod';
import type { PLATFORMS } from './publish.js';

const secret = z.string().trim().min(8).max(2048);

export const credentialSchemas = {
  youtube: z.strictObject({ clientId: secret, clientSecret: secret, refreshToken: secret }),
  instagram: z.strictObject({ accessToken: secret, userId: z.string().regex(/^[0-9]{5,30}$/) }),
  tiktok: z.strictObject({ accessToken: secret, openId: secret }),
} as const;

export const credentialEntriesSchema = z
  .record(z.string().max(80), z.record(z.string().max(40), z.string().max(2048)))
  .default({});

export const legacyCredentialFileSchema = z.strictObject({ entries: credentialEntriesSchema });

export const sealedCredentialFileSchema = z.strictObject({
  version: z.literal(1),
  sealed: z
    .string()
    .min(1)
    .max(4 * 1024 * 1024),
});

export const credentialFileSchema = z.union([
  sealedCredentialFileSchema,
  legacyCredentialFileSchema,
]);

export type CredentialEntries = z.infer<typeof credentialEntriesSchema>;
export type CredentialFile = z.infer<typeof credentialFileSchema>;
export type CredentialData<P extends (typeof PLATFORMS)[number]> = z.infer<
  (typeof credentialSchemas)[P]
>;
