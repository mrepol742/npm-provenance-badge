export type PublisherType = 'user' | 'scope';

export interface Publisher {
  name: string;
  type: PublisherType;
  key: string;
}

export interface Release {
  name: string;
  version: string;
  integrity?: string;
  attestations?: { url: string; predicateType: string };
}
