import type { Locator, Page } from 'playwright-core';

export function normalizeComment(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u200B\u2060\uFEFF\uFE0E\uFE0F]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export async function renderedComments(candidates: Locator): Promise<string[]> {
  const texts = await candidates.evaluateAll((items) => {
    function read(node: (typeof items)[number]['childNodes'][number]): string {
      if (node.nodeType === 3) return node.textContent ?? '';
      if (node.nodeType !== 1) return '';
      const element = node as (typeof items)[number];
      if (element.tagName === 'IMG') return element.getAttribute('alt') ?? '';
      if (element.tagName === 'BR') return '\n';
      return [...element.childNodes].map(read).join('');
    }
    return items
      .filter((item) => {
        if (item.closest('[contenteditable="true"], textarea, [role="textbox"]')) return false;
        const rect = item.getBoundingClientRect();
        const style = item.ownerDocument.defaultView?.getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden';
      })
      .map(read);
  });
  return texts.map(normalizeComment);
}

export interface CommentConfirmation {
  confirmed(): Promise<boolean>;
}

export async function prepareCommentConfirmation(
  candidates: Locator,
  editor: Locator,
  text: string,
): Promise<CommentConfirmation> {
  const expected = normalizeComment(text);
  const count = async (): Promise<number> =>
    (await renderedComments(candidates)).filter((value) => value === expected).length;
  const before = await count();
  return {
    async confirmed(): Promise<boolean> {
      if (!expected || (await count()) <= before) return false;
      return editor.evaluateAll((items) => {
        const element = items[0] as unknown as
          { value?: string; textContent: string | null } | undefined;
        return (element?.value ?? element?.textContent ?? '').trim() === '';
      });
    },
  };
}

export async function waitForCommentConfirmation(
  page: Page,
  confirmation: CommentConfirmation,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await confirmation.confirmed()) return;
    await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(
    'O YouTube não confirmou a publicação deste comentário. Confira a rede; esta tentativa não será repetida automaticamente.',
  );
}
