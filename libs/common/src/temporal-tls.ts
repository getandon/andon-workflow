import { readFileSync } from 'fs';

export interface TemporalTlsOptions {
  serverNameOverride?: string;
  serverRootCACertificate?: Buffer;
  clientCertPair?: { crt: Buffer; key: Buffer };
}

export function temporalNamespace(): string {
  return process.env.TEMPORAL_NAMESPACE ?? 'default';
}

export function buildTemporalTls(): TemporalTlsOptions | true | undefined {
  const enabled = process.env.TEMPORAL_TLS === 'true';
  const certPath = process.env.TEMPORAL_TLS_CLIENT_CERT_PATH;
  const keyPath = process.env.TEMPORAL_TLS_CLIENT_KEY_PATH;

  if (!enabled && !certPath) return undefined;
  if (!certPath) return true;
  if (!keyPath) {
    throw new Error(
      'TEMPORAL_TLS_CLIENT_KEY_PATH is required when TEMPORAL_TLS_CLIENT_CERT_PATH is set',
    );
  }

  const tls: TemporalTlsOptions = {
    clientCertPair: {
      crt: readFileSync(certPath),
      key: readFileSync(keyPath),
    },
  };

  const caPath = process.env.TEMPORAL_TLS_SERVER_ROOT_CA_PATH;
  if (caPath) tls.serverRootCACertificate = readFileSync(caPath);

  const serverName = process.env.TEMPORAL_TLS_SERVER_NAME;
  if (serverName) tls.serverNameOverride = serverName;

  return tls;
}
