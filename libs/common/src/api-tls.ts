import { readFileSync } from 'fs';
import * as https from 'https';

export interface ApiTlsRequestOptions {
  cert?: Buffer;
  key?: Buffer;
  ca?: Buffer;
  servername?: string;
}

export function buildApiTlsOptions(): ApiTlsRequestOptions | undefined {
  const certPath =
    process.env.ANDON_API_TLS_CLIENT_CERT_PATH ??
    process.env.TEMPORAL_TLS_CLIENT_CERT_PATH;
  const keyPath =
    process.env.ANDON_API_TLS_CLIENT_KEY_PATH ??
    process.env.TEMPORAL_TLS_CLIENT_KEY_PATH;
  const caPath =
    process.env.ANDON_API_TLS_SERVER_ROOT_CA_PATH ??
    process.env.TEMPORAL_TLS_SERVER_ROOT_CA_PATH;

  if (!certPath) return undefined;

  if (!keyPath) {
    throw new Error(
      'ANDON_API_TLS_CLIENT_KEY_PATH (or TEMPORAL_TLS_CLIENT_KEY_PATH) is required when a client cert path is set',
    );
  }

  const opts: ApiTlsRequestOptions = {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
  if (caPath) opts.ca = readFileSync(caPath);

  const serverName =
    process.env.ANDON_API_TLS_SERVER_NAME ??
    process.env.TEMPORAL_TLS_SERVER_NAME;
  if (serverName) opts.servername = serverName;

  return opts;
}

export interface ApiRequestResult {
  ok: boolean;
  status: number;
  text: string;
}

export function apiRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  tlsOptions?: ApiTlsRequestOptions,
): Promise<ApiRequestResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const opts: https.RequestOptions = {
      method: init.method,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      headers: init.headers,
    };

    const agent =
      tlsOptions && (tlsOptions.cert || tlsOptions.ca)
        ? new https.Agent({
            cert: tlsOptions.cert as Buffer,
            key: tlsOptions.key as Buffer,
            ca: tlsOptions.ca as Buffer,
            servername: tlsOptions.servername ?? parsed.hostname,
            keepAlive: true,
          })
        : undefined;

    opts.servername = tlsOptions?.servername ?? parsed.hostname;
    if (agent) opts.agent = agent;

    const r = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString('utf8')));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, text: data });
      });
    });
    r.on('error', reject);
    if (init.body) r.write(init.body);
    r.end();
  });
}