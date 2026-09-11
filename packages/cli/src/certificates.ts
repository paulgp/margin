import * as fs from 'node:fs';
import * as path from 'node:path';
import {X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';

/** Only public trust roots shipped with Node, never user keychains, environment CA files, or keys. */
export function publicCertificateBundle(certificates: readonly string[] = rootCertificates): {pem: string; count: number} {
  if (!certificates.length || certificates.length > 1024) throw new Error('The Node public CA bundle has an unsupported certificate count');
  const unique = new Map<string, string>();
  let bytes = 0;
  for (const pem of certificates) {
    bytes += Buffer.byteLength(pem);
    if (bytes > 2 * 1024 * 1024) throw new Error('The Node public CA bundle exceeds 2 MiB');
    if (!/^\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(pem)) throw new Error('The Node public CA bundle must contain certificates only');
    let certificate: X509Certificate;
    try { certificate = new X509Certificate(pem); } catch { throw new Error('The Node public CA bundle contains an invalid certificate'); }
    if (!certificate.ca) throw new Error('The Node public CA bundle contains a non-CA certificate');
    unique.set(certificate.fingerprint256, certificate.toString().trim());
  }
  return {pem: [...unique.values()].join('\n') + '\n', count: unique.size};
}

/** Called only with a fresh, private Margin-owned temp directory, before starting the reviewer. */
export function installPublicCertificates(temp: string): {file: string; count: number} {
  const bundle = publicCertificateBundle();
  const file = path.join(temp, 'public-ca-certificates.pem');
  fs.writeFileSync(file, bundle.pem, {mode: 0o600, flag: 'wx'});
  return {file, count: bundle.count};
}
