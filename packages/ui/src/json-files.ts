// File content is data only. Never infer trust from an extension or MIME type.
export async function readJsonFile(
  file: File,
  maximum = 1024 * 1024,
): Promise<unknown> {
  if (!file.size || file.size > maximum)
    throw new Error(
      `Choose a non-empty JSON file no larger than ${maximum} bytes.`,
    );
  const text = await file.slice(0, maximum + 1).text();
  if (new TextEncoder().encode(text).length > maximum)
    throw new Error('The selected file is too large.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      'The selected file is not valid JSON. Choose the original exported file.',
    );
  }
}
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
