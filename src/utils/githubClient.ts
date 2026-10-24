import crypto from 'crypto';
import { redactSecrets } from './githubCrypto.ts';

export interface GitHubApiResponse<T> {
  status: number;
  data: T | null;
  etag: string | null;
  notModified: boolean;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
}

/**
 * Parses GitHub HTTP Link pagination header.
 * e.g. <https://api.github.com/...?page=2>; rel="next", <https://...>; rel="last"
 */
export function parseLinkHeader(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const links: Record<string, string> = {};
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }
  return links;
}

/**
 * Verifies GitHub Webhook HMAC-SHA256 signature using constant-time comparison.
 */
export function verifyWebhookSignature(
  rawPayload: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const cleanHeader = signatureHeader.trim();
  if (!cleanHeader.startsWith('sha256=')) return false;

  const expectedSigHex = cleanHeader.slice(7);
  const payloadBuffer = typeof rawPayload === 'string' ? Buffer.from(rawPayload, 'utf8') : rawPayload;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadBuffer);
  const computedSigHex = hmac.digest('hex');

  const expectedBuf = Buffer.from(expectedSigHex, 'hex');
  const computedBuf = Buffer.from(computedSigHex, 'hex');

  if (expectedBuf.length !== computedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, computedBuf);
}

/**
 * Robust HTTP client for GitHub REST API respecting rate limits, ETags, and errors.
 */
export async function callGitHubApi<T = any>(
  urlOrEndpoint: string,
  options: {
    token?: string | null;
    etag?: string | null;
    method?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<GitHubApiResponse<T>> {
  const url = urlOrEndpoint.startsWith('http')
    ? urlOrEndpoint
    : `https://api.github.com${urlOrEndpoint.startsWith('/') ? '' : '/'}${urlOrEndpoint}`;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'PULSE-PM/2.0',
    ...(options.headers || {})
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token.trim()}`;
  }

  if (options.etag) {
    headers['If-None-Match'] = options.etag;
  }

  let requestBody: string | undefined = undefined;
  if (options.body) {
    requestBody = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: requestBody
    });

    const etag = res.headers.get('etag');
    const rateLimitRemaining = res.headers.get('x-ratelimit-remaining')
      ? parseInt(res.headers.get('x-ratelimit-remaining')!, 10)
      : null;
    const rateLimitReset = res.headers.get('x-ratelimit-reset')
      ? parseInt(res.headers.get('x-ratelimit-reset')!, 10)
      : null;
    const retryAfter = res.headers.get('retry-after')
      ? parseInt(res.headers.get('retry-after')!, 10)
      : null;

    if (res.status === 304) {
      return {
        status: 304,
        data: null,
        etag,
        notModified: true,
        rateLimitRemaining,
        rateLimitReset
      };
    }

    if (res.status === 429 || (res.status === 403 && rateLimitRemaining === 0)) {
      const waitSeconds = retryAfter || (rateLimitReset ? Math.max(0, rateLimitReset - Math.floor(Date.now() / 1000)) : 60);
      throw new Error(`GitHub rate limit exceeded. Reset in ${waitSeconds}s.`);
    }

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: `HTTP ${res.status}` };
      }
      const safeMessage = redactSecrets(errBody?.message || `HTTP ${res.status}`);
      throw new Error(`GitHub API Error (${res.status}): ${safeMessage}`);
    }

    const data: T = await res.json();
    return {
      status: res.status,
      data,
      etag,
      notModified: false,
      rateLimitRemaining,
      rateLimitReset
    };
  } catch (err: any) {
    throw new Error(redactSecrets(err.message || 'Network error communicating with GitHub'));
  }
}

/**
 * Paginates through GitHub API list endpoints with safety caps.
 */
export async function paginateGitHubApi<T = any>(
  endpoint: string,
  token?: string | null,
  maxPages: number = 3,
  perPage: number = 30
): Promise<{ items: T[]; rateLimitRemaining: number | null }> {
  let nextUrl: string | null = endpoint.includes('per_page')
    ? endpoint
    : `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=${perPage}`;

  const allItems: T[] = [];
  let pagesFetched = 0;
  let lastRemaining: number | null = null;

  while (nextUrl && pagesFetched < maxPages) {
    pagesFetched++;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PULSE-PM/2.0'
    };
    if (token) headers['Authorization'] = `Bearer ${token.trim()}`;

    const res = await fetch(nextUrl, { headers });
    lastRemaining = res.headers.get('x-ratelimit-remaining')
      ? parseInt(res.headers.get('x-ratelimit-remaining')!, 10)
      : null;

    if (!res.ok) {
      if (res.status === 404) break;
      throw new Error(`GitHub pagination failed at ${nextUrl}: HTTP ${res.status}`);
    }

    const data: T[] = await res.json();
    if (Array.isArray(data)) {
      allItems.push(...data);
    } else {
      break;
    }

    const linkHeader = res.headers.get('link');
    const links = parseLinkHeader(linkHeader);
    nextUrl = links['next'] || null;
  }

  return { items: allItems, rateLimitRemaining: lastRemaining };
}
