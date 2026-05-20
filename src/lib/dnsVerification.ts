import { promises as dns } from 'node:dns';

/**
 * DNS error codes that mean "no record exists at this host" (as opposed to
 * a network/transport failure we should surface). Treated as "lookup miss"
 * by the fallback logic in verifyDmarcTxt.
 */
const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NOTFOUND', 'NODATA']);

/**
 * Performs one DMARC TXT lookup at `host` and returns the first record
 * starting with `v=DMARC1`, or null if no such record exists at that host.
 *
 * Returns null (instead of throwing) for "no record" responses so the
 * caller can choose to fall back to the organizational domain. Non-miss
 * DNS errors (SERVFAIL, timeout, etc.) are surfaced as thrown Errors.
 */
async function lookupDmarcRecord(host: string): Promise<string | null> {
  let records: string[][];
  try {
    records = await dns.resolveTxt(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    if (NOT_FOUND_CODES.has(code)) return null;
    throw new Error(`DMARC TXT lookup failed for ${host}: ${code}`);
  }

  const joined = records.map((parts) => parts.join(''));
  return joined.find((rec) => rec.startsWith('v=DMARC1')) ?? null;
}

/**
 * Derives the organizational (parent) domain by taking the last two labels.
 * Returns null when the input is already two labels or fewer.
 *
 * Simplification: this does NOT consult the Public Suffix List, so domains
 * like `foo.co.uk` collapse to `co.uk` (incorrect). Acceptable for the
 * demo path; v2 should swap in `psl` or `tldts`.
 */
function organizationalDomain(domain: string): string | null {
  const labels = domain.split('.').filter(Boolean);
  if (labels.length <= 2) return null;
  return labels.slice(-2).join('.');
}

/**
 * Resolves `_dmarc.<domain>` TXT records and returns the first record that
 * begins with `v=DMARC1`. If the direct lookup misses, falls back to the
 * organizational domain per RFC 7489 §6.6.3 (e.g. `mail.example.com` →
 * `example.com`). Throws a descriptive Error if neither host yields a
 * DMARC1 record, or on transport-level DNS failures.
 *
 * Called only on the write path (§5.1) — never at read time.
 *
 * @param domain - the registrant's declared domain (e.g. "example.com" or "agents.example.com")
 * @returns the raw DMARC TXT string (e.g. "v=DMARC1; p=reject; ...")
 * @throws Error when both lookups fail or on a non-miss DNS error
 */
export async function verifyDmarcTxt(domain: string): Promise<string> {
  const directHost = `_dmarc.${domain}`;
  const direct = await lookupDmarcRecord(directHost);
  if (direct) return direct;

  // RFC 7489 §6.6.3: fall back to the organizational domain when the
  // subdomain has no DMARC record of its own.
  const orgDomain = organizationalDomain(domain);
  if (!orgDomain || orgDomain === domain) {
    throw new Error(`No DMARC TXT record found at ${directHost}`);
  }

  const parentHost = `_dmarc.${orgDomain}`;
  const parent = await lookupDmarcRecord(parentHost);
  if (parent) return parent;

  throw new Error(`No DMARC TXT record found at ${directHost} or ${parentHost}`);
}
