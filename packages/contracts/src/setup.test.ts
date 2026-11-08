import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { offlineRegistrationSchema, licenseHandoffSchema } from './setup.js';

test('registration descriptors reject missing identity, extra fields and credential material', () => {
  const descriptor = {
    format: 'gst-offline-registration',
    version: 1,
    organizationId: randomUUID(),
    installationId: randomUUID(),
    name: 'Example',
  };
  expect(offlineRegistrationSchema.safeParse(descriptor).success).toBe(true);
  expect(
    offlineRegistrationSchema.safeParse({ ...descriptor, installationId: '' })
      .success,
  ).toBe(false);
  expect(
    offlineRegistrationSchema.safeParse({
      ...descriptor,
      privateKey: 'never accepted',
    }).success,
  ).toBe(false);
  expect(licenseHandoffSchema.safeParse(descriptor).success).toBe(false);
});
