import { buildConfig } from '../config/index.js';

/**
 * Issues an HTTP HEAD request to `rapUrl` to verify the RAP endpoint is
 * reachable and returns a 2xx status.
 *
 * Per §9 (TLS invariant): HTTPS is enforced by the JSON schema on rap_url
 * before this function is called; self-signed certs will be rejected by
 * Node's default TLS verification.
 *
 * Called only on the write path (§5.1) — never at read time.
 * When GARR_DEMO_MODE=true, skips the reachability check entirely.
 *
 * @param rapUrl - URL of the organization's agents.json endpoint
 * @throws Error when the request fails or the status is not 2xx
 */
export async function headRap(rapUrl: string): Promise<void> {
  if (buildConfig().demoMode) return;

  let res: Response;
  try {
    res = await fetch(rapUrl, { method: 'HEAD', redirect: 'follow' });
  } catch (err) {
    throw new Error(`RAP reachability check failed for ${rapUrl}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`RAP endpoint returned HTTP ${res.status} for ${rapUrl}`);
  }
}
