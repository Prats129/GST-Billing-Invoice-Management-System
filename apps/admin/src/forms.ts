export const value = (d: FormData, key: string) =>
  String(d.get(key) ?? '').trim();
export const iso = (d: FormData, key: string) =>
  new Date(value(d, key)).toISOString();
export const now = () =>
  new Date(Date.now() + 5 * 60000 - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
