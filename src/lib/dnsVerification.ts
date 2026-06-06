import { promises as dns } from 'node:dns';
import { buildConfig } from '../config/index.js';

/**
 * Resolves `_dmarc.<domain>` TXT records and returns the first record that
 * begins with `v=DMARC1`. Throws a descriptive Error on DNS failure or when
 * no DMARC record is found.
 *
 * Called only on the write path (§5.1) — never at read time.
 * When GARR_DEMO_MODE=true, returns a stub DMARC policy without a DNS lookup.
 *
 * @param domain - the registrant's declared domain (e.g. "example.com")
 * @returns the raw DMARC TXT string (e.g. "v=DMARC1; p=reject; ...")
 * @throws Error when the lookup fails or no DMARC1 record exists
 */
export async function verifyDmarcTxt(domain: string): Promise<string> {
  if (buildConfig().demoMode) return 'v=DMARC1; p=none';

  const dmarcHost = `_dmarc.${domain}`;
  let records: string[][];
  try {
    records = await dns.resolveTxt(dmarcHost);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    throw new Error(`DMARC TXT lookup failed for ${dmarcHost}: ${code}`);
  }

  const dmarcRecord = records
    .map((parts) => parts.join(''))
    .find((rec) => rec.startsWith('v=DMARC1'));

  if (!dmarcRecord) {
    throw new Error(`No DMARC TXT record found at ${dmarcHost}`);
  }

  return dmarcRecord;
}
