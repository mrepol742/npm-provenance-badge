export {
  createProvenanceService,
  getProvenanceStats,
  type ServiceOptions,
} from './lib/service.js';
export { createApp, type AppOptions } from './api/app.js';
export { MemoryCache } from './lib/cache/memory.js';
export type { Cache } from './lib/cache/cache.js';
export type {
  ProvenanceStats,
  BundleVerifier,
} from './lib/provenance/types.js';
export type { PublisherType } from './lib/npm/types.js';
export { ProvenanceError } from './lib/errors.js';
export { renderBadge, renderSvg, type Display } from './lib/badge/render.js';
export { automaticColor, coverageColors } from './lib/badge/colors.js';

export type { ColorThreshold } from './lib/badge/colors.js';
