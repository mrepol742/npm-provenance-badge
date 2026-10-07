import type { ProvenanceStats } from '../provenance/types.js';
import { automaticColor, type ColorThreshold } from './colors.js';

export type Display = 'count' | 'ratio' | 'percentage';

export function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  );
}

export function badgeValue(stats: ProvenanceStats, display: Display): string {
  if (display === 'count') return `${stats.provenancePackages} packages`;
  if (display === 'percentage')
    return stats.totalPackages ? `${Math.round(stats.coverage)}%` : 'n/a';
  return `${stats.provenancePackages} / ${stats.totalPackages}`;
}

export function renderSvg(value: string, color: string): string {
  const label = 'npm provenance';
  const left = 112;
  const right = Math.max(42, value.length * 7 + 16);
  const width = left + right;
  const safeValue = escapeXml(value);
  const safeColor = escapeXml(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${safeValue}"><title>${label}: ${safeValue}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><path fill="#555" d="M0 0h${left}v20H0z"/><path fill="${safeColor}" d="M${left} 0h${right}v20H${left}z"/><path fill="url(#s)" d="M0 0h${width}v20H0z"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${left / 2}" y="14">${label}</text><text x="${left + right / 2}" y="14">${safeValue}</text></g></svg>`;
}

export function renderBadge(
  stats: ProvenanceStats,
  display: Display = 'ratio',
  color?: string,
  thresholds?: readonly ColorThreshold[],
): string {
  return renderSvg(
    badgeValue(stats, display),
    color ??
      (stats.totalPackages
        ? automaticColor(
            (stats.provenancePackages / stats.totalPackages) * 100,
            thresholds,
          )
        : '#555'),
  );
}
