import { createVerifier } from 'sigstore';
import type { BundleVerifier } from './types.js';

// Share trust-root initialization, including concurrent calls, across publishers.
// Periodically refresh through authenticated TUF metadata; never pin an expired cache.
let verifier: ReturnType<typeof createVerifier> | undefined;
let expires = 0;

export const verifyBundle: BundleVerifier = async (bundle) => {
  if (!verifier || Date.now() >= expires) {
    const initialization = createVerifier({
      tlogThreshold: 1,
      ctLogThreshold: 1,
      timeout: 10000,
      retry: 1,
    });
    verifier = initialization;
    expires = Date.now() + 15 * 60 * 1000;
    void initialization.catch(() => {
      if (verifier === initialization) {
        verifier = undefined;
        expires = 0;
      }
    });
  }
  const trusted = await verifier;
  trusted.verify(bundle as Parameters<typeof trusted.verify>[0]);
};
