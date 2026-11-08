import { expect, test } from 'vitest';
import { readJsonFile } from './json-files.js';

test('reads bounded JSON as data regardless of MIME or extension', async () => {
  expect(
    await readJsonFile(
      new File(['{"name":"<script>never executed</script>"}'], 'data.txt', {
        type: 'text/plain',
      }),
    ),
  ).toEqual({ name: '<script>never executed</script>' });
});
test('rejects empty, malformed and oversized files before accepting data', async () => {
  await expect(readJsonFile(new File([], 'empty.json'))).rejects.toThrow(
    'non-empty',
  );
  await expect(
    readJsonFile(new File(['not JSON'], 'invalid.json')),
  ).rejects.toThrow('not valid JSON');
  await expect(
    readJsonFile(new File(['"😀"'], 'unicode.json'), 4),
  ).rejects.toThrow('no larger');
  await expect(
    readJsonFile(new File([' '.repeat(1000)], 'large.json'), 100),
  ).rejects.toThrow('no larger');
});
