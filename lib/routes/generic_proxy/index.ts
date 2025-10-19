import { Route, ViewType } from '@/types';
import { config } from '@/config';

const ENV: Record<string, string | undefined> = (globalThis as any)?.process?.env ?? {};

const DEFAULT_TIMEOUT_MS = Number(ENV.GENERIC_PROXY_TIMEOUT ?? config.requestTimeout ?? 10000);
const DEFAULT_MAX_RESPONSE_SIZE = Number(ENV.GENERIC_PROXY_MAX_SIZE ?? 10 * 1024 * 1024);
const DEFAULT_UA = ENV.GENERIC_PROXY_UA ?? config.ua ?? 'RSSHub (Generic Proxy)';

async function handler(ctx) {
    if ((ctx.req.method || '').toUpperCase() !== 'GET') {
        ctx.status(405);
        ctx.header('Allow', 'GET');
        return ctx.text('Method Not Allowed', 405);
    }

    const { url: encodedUrl } = ctx.req.param();
    if (!encodedUrl) {
        return ctx.text('URL parameter is required', 400);
    }

    let targetUrl: string;
    try {
        targetUrl = decodeURIComponent(encodedUrl);
        const parsed = new URL(targetUrl);
        if (!/^https?:$/.test(parsed.protocol)) {
            throw new Error('Unsupported protocol');
        }
    } catch {
        return ctx.text('Invalid URL format', 400);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        const resp = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'user-agent': DEFAULT_UA,
                accept: '*/*',
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const status = resp.status;

        const headersToProxy = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'content-disposition'];
        const outHeaders = new Headers();
        for (const name of headersToProxy) {
            const value = resp.headers.get(name);
            if (value !== null) {
                outHeaders.set(name, value);
            }
        }

        const body = await resp.arrayBuffer();

        if (body.byteLength > DEFAULT_MAX_RESPONSE_SIZE) {
            return ctx.text('Response too large', 413);
        }

        return new Response(body, { status, headers: outHeaders });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            return ctx.text('Request timeout', 408);
        }
        return ctx.text('Internal server error while fetching the file', 500);
    }
}

export const route: Route = {
    path: '/:url{.+}',
    categories: ['other'],
    example: '/generic_proxy/https%3A%2F%2Fremote-server.com%2Frss.xml',
    view: ViewType.Notifications,
    parameters: {
        url: 'URL-encoded absolute http/https URL, e.g. `https%3A%2F%2Fremote-server.com%2Frss.xml`',
    },
    features: {
        requireConfig: [],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Generic File Proxy',
    maintainers: ['synchrone'],
    handler,
    description: `Proxies arbitrary http/https resources. The target URL must be URL-encoded.`,
};

export default handler;
