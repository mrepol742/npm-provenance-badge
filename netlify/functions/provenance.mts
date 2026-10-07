import type { Config, Context } from '@netlify/functions';
import { createApp } from '../../.netlify/bundle/app.mjs';

process.env.XDG_DATA_HOME = '/tmp';

const app = createApp();

export default async function handler(
  request: Request,
  context: Context,
): Promise<Response> {
  const response = await app(request, context.ip);

  if (response.headers.get('cache-control') !== 'no-store') {
    response.headers.set(
      'Netlify-CDN-Cache-Control',
      'public, durable, s-maxage=1800',
    );
    response.headers.set('Netlify-Vary', 'query');
  }

  return response;
}

export const config: Config = {
  path: ['/badge/:publisher', '/api/provenance/:publisher'],
};
