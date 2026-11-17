import type { Platform } from '../contracts/publish.js';
import type { QueueStore } from '../publish/queue-store.js';
import type { ProducedClip } from './live-session.js';

const TITLE_LIMIT = 100;

export async function enqueueClip(
  queue: Pick<QueueStore, 'add'>,
  platforms: readonly Platform[],
  clip: ProducedClip,
): Promise<number> {
  let added = 0;
  for (const item of clip.files) {
    if (item.account === null) continue;
    for (const platform of platforms) {
      await queue.add({
        file: item.file,
        account: item.account,
        platform,
        title: (clip.hook ?? clip.id).slice(0, TITLE_LIMIT),
      });
      added += 1;
    }
  }
  return added;
}
