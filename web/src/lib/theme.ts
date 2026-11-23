import { useEffect, useState } from 'react';
import { DARK_QUERY, STORAGE_KEY } from './theme-script';

export type ThemeChoice = 'light' | 'dark' | 'system';

const CHANGE_EVENT = 'cortes:theme';

export function readTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  const next = resolve(choice);
  if (root.dataset.theme === next) return;
  root.setAttribute('data-theme-switching', '');
  root.dataset.theme = next;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => root.removeAttribute('data-theme-switching'));
  });
}

function store(choice: ThemeChoice): boolean {
  try {
    if (choice === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

export function saveTheme(choice: ThemeChoice): void {
  store(choice);
  apply(choice);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useThemeSync(): void {
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const sync = (): void => apply(readTheme());
    const fromStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY || event.key === null) sync();
    };
    sync();
    media.addEventListener('change', sync);
    window.addEventListener('storage', fromStorage);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('storage', fromStorage);
    };
  }, []);
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => {
    const read = (): void => setChoice(readTheme());
    read();
    window.addEventListener(CHANGE_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(CHANGE_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return [choice, saveTheme];
}
