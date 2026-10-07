import { ProvenanceError, record } from '../errors.js';
import type { NpmClient } from '../npm/client.js';
import type { Release } from '../npm/types.js';
import type { BundleVerifier } from './types.js';
import { verifyBundle } from './verifier.js';

const predicates = new Set([
  'https://slsa.dev/provenance/v1',
  'https://slsa.dev/provenance/v0.2',
]);

export function packageUrl(release: Release): string {
  return `pkg:npm/${release.name.replace('@', '%40')}@${release.version}`;
}

export async function checkRelease(
  client: NpmClient,
  release: Release,
  verifier: BundleVerifier = verifyBundle,
): Promise<boolean> {
  if (!release.attestations) return false;
  const advertised = release.attestations;
  const expectedPath = `/-/npm/v1/attestations/${release.name}@${release.version}`;
  let url: URL;
  try {
    url = new URL(advertised.url);
  } catch {
    throw new ProvenanceError('VERIFICATION_FAILED', 'Invalid attestation URL');
  }
  if (
    url.origin !== 'https://registry.npmjs.org' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    decodeURIComponent(url.pathname) !== expectedPath
  )
    throw new ProvenanceError(
      'VERIFICATION_FAILED',
      'Attestation URL rejected',
    );
  if (!predicates.has(advertised.predicateType))
    throw new ProvenanceError(
      'VERIFICATION_FAILED',
      'Unsupported provenance predicate',
    );
  let raw: unknown;
  try {
    raw = await client.get(url.href);
  } catch (error) {
    if (error instanceof ProvenanceError && error.code === 'NOT_FOUND')
      throw new ProvenanceError(
        'VERIFICATION_FAILED',
        'Advertised attestation missing',
      );
    throw error;
  }
  const data = record(raw);
  try {
    if (!Array.isArray(data.attestations))
      throw new Error('Malformed attestations');
    const matches = data.attestations.filter(
      (item: unknown) =>
        record(item).predicateType === advertised.predicateType,
    );
    if (matches.length !== 1)
      throw new Error('Missing or ambiguous provenance');
    const bundle = record(record(matches[0]).bundle);
    const envelope = record(bundle.dsseEnvelope);
    const material = record(bundle.verificationMaterial);
    if (
      (!material.certificate && !material.x509CertificateChain) ||
      material.publicKey ||
      envelope.payloadType !== 'application/vnd.in-toto+json' ||
      typeof envelope.payload !== 'string'
    )
      throw new Error('Expected certificate-backed DSSE');
    const statement = record(
      JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')),
    );
    if (
      ![
        'https://in-toto.io/Statement/v1',
        'https://in-toto.io/Statement/v0.1',
      ].includes(statement._type) ||
      statement.predicateType !== advertised.predicateType ||
      !statement.predicate ||
      !Array.isArray(statement.subject) ||
      statement.subject.length !== 1
    )
      throw new Error('Invalid statement');
    const subject = record(statement.subject[0]);
    const digest = record(subject.digest);
    const integrity = release.integrity
      ?.split(/\s+/)
      .find((part) => /^sha512-[A-Za-z0-9+/]{86}==$/.test(part));
    if (
      !integrity ||
      subject.name !== packageUrl(release) ||
      digest.sha512 !==
        Buffer.from(integrity.slice(7), 'base64').toString('hex')
    )
      throw new Error('Subject mismatch');
    await verifier(bundle);
    return true;
  } catch {
    throw new ProvenanceError(
      'VERIFICATION_FAILED',
      'Provenance verification failed',
    );
  }
}
