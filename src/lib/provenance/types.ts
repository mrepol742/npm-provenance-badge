import type { Release } from '../npm/types.js';

export interface ProvenanceStats {
  publisher: string;
  totalPackages: number;
  provenancePackages: number;
  withoutProvenance: number;
  coverage: number;
  checkedAt: string;
}

export type BundleVerifier = (bundle: unknown) => Promise<void>;

export type ReleaseChecker = (release: Release) => Promise<boolean>;
