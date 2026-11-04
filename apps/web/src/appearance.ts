import { useEffect } from 'react';
import { defaultAppearance } from '@gst/contracts';
import type { Appearance } from '@gst/contracts';

export function applyAppearance(appearance: Appearance, systemDark: boolean) {
  const dark =
    appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = appearance.accent;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0f172a' : '#f4f7fa');
}
export function useAppearance(appearance: Appearance = defaultAppearance) {
  const { mode, accent } = appearance;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyAppearance({ mode, accent }, media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode, accent]);
}
