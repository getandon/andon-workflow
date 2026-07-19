import { readFileSync } from 'fs';
import { X509Certificate } from 'crypto';

export interface ClientCertMeta {
  notAfter: string;
  notBefore: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  keyUsage: string[];
  fingerprint: string;
}

export interface CaCertMeta {
  notAfter: string;
  subject: string;
}

export interface CertInfo {
  tlsEnabled: boolean;
  temporalTls: boolean;
  apiTls: boolean;
  clientCert?: ClientCertMeta;
  caCert?: CaCertMeta;
}

export function collectCertInfo(): CertInfo {
  const certPath = process.env.TEMPORAL_TLS_CLIENT_CERT_PATH;
  const keyPath = process.env.TEMPORAL_TLS_CLIENT_KEY_PATH;
  const caPath = process.env.TEMPORAL_TLS_SERVER_ROOT_CA_PATH;
  const temporalTls = process.env.TEMPORAL_TLS === 'true' || !!certPath;

  const apiCertPath =
    process.env.ANDON_API_TLS_CLIENT_CERT_PATH ?? certPath;
  const apiKeyPath =
    process.env.ANDON_API_TLS_CLIENT_KEY_PATH ?? keyPath;
  const apiTls = !!apiCertPath && !!apiKeyPath;

  const info: CertInfo = {
    tlsEnabled: temporalTls || apiTls,
    temporalTls,
    apiTls,
  };

  if (certPath) {
    try {
      const pem = readFileSync(certPath, 'utf-8');
      const cert = new X509Certificate(pem);
      info.clientCert = {
        notAfter: cert.validTo,
        notBefore: cert.validFrom,
        subject: cert.subject,
        issuer: cert.issuer,
        serialNumber: cert.serialNumber,
        keyUsage: cert.keyUsage ?? [],
        fingerprint: cert.fingerprint256,
      };
    } catch {}
  }

  if (caPath) {
    try {
      const pem = readFileSync(caPath, 'utf-8');
      const ca = new X509Certificate(pem);
      info.caCert = {
        notAfter: ca.validTo,
        subject: ca.subject,
      };
    } catch {}
  }

  return info;
}
