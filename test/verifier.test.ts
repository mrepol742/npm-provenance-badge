import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), create: vi.fn() }));
vi.mock('sigstore', () => ({ createVerifier: mocks.create }));

import { verifyBundle } from '../src/lib/provenance/verifier.js';
it('delegates cryptography and reuses trust initialization; never suppresses rejection', async () => {
  mocks.create.mockResolvedValue({ verify: mocks.verify });
  await Promise.all([verifyBundle({ a: 1 }), verifyBundle({ b: 2 })]);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledWith({
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 10000,
    retry: 1,
  });
  expect(mocks.verify).toHaveBeenCalledTimes(2);
  mocks.verify.mockImplementationOnce(() => {
    throw new Error('signature rejected');
  });
  await expect(verifyBundle({})).rejects.toThrow('signature rejected');
});
