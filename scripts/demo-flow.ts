/**
 * Demo flow — runs the full Layer 1 → Layer 2 → Layer 3 resolution chain
 * for three agent locators and prints each step.
 *
 * Requires:
 *   - GARR server running with GARR_DEMO_MODE=true  (Terminal 1)
 *   - Mock RAP servers running                       (Terminal 2, npm run demo:rap)
 *   - Demo orgs seeded                               (npm run demo:seed)
 *
 * Run: npm run demo:run
 */

// eslint-disable-next-line n/no-process-env
const GARR_BASE = process.env['GARR_URL'] ?? 'http://localhost:3000';

interface IndexRecord {
  agent_id: string;
  agent_name: string;
  card_url: string;
  ttl: number;
  signature: string;
}

interface AgentCard {
  id: string;
  display_name: string;
  description: string;
  capabilities: string[];
  invocation_url: string;
  protocol: string;
  visibility: string;
  signed_by: string;
  signature: string;
  [key: string]: unknown;
}

interface ResolveResponse {
  locator: string;
  resolution_mode: string;
  resolved_via: string;
  index_record: IndexRecord;
  agent_card: AgentCard;
}

interface ApiError {
  error: string;
  detail?: string;
}

/**
 * Derives the RAP base URL from the card_url in the IndexRecord.
 * card_url is `<rap_url>/agents/<slug>`, so strip from "/agents/" onward.
 */
function rapUrlFromCardUrl(cardUrl: string): string {
  const idx = cardUrl.indexOf('/agents/');
  return idx !== -1 ? cardUrl.slice(0, idx) : cardUrl;
}

/**
 * Resolves one agent locator against the GARR server and prints each step
 * of the Layer 1 → Layer 2 → Layer 3 chain.
 */
async function resolveAndPrint(locator: string): Promise<void> {
  // Parse locator for display
  const colonIdx = locator.lastIndexOf(':');
  const atIdx = locator.indexOf('@');
  const identifier = locator.slice(0, atIdx);
  const namespace = locator.slice(atIdx + 1, colonIdx);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Locator: ${locator}`);
  console.log('─'.repeat(60));

  // Step 1 — Layer 1: GARR looks up the org (acts as the NANDA Index)
  console.log(`→ Querying NANDA for ${namespace}…`);

  const res = await fetch(
    `${GARR_BASE}/api/v1/resolve?locator=${encodeURIComponent(locator)}`,
  );

  if (!res.ok) {
    const err = (await res.json()) as ApiError;
    console.error(`✗ Resolution failed: ${err.error} — ${err.detail ?? ''}`);
    return;
  }

  const result = (await res.json()) as ResolveResponse;
  const rapUrl = rapUrlFromCardUrl(result.index_record.card_url);

  console.log(`✓ RAP URL: ${rapUrl}`);

  // Step 2 — Layer 2: AgentCard fetched from the org's RAP
  console.log(`→ Fetching AgentCard ${identifier} from RAP…`);
  console.log(`✓ AgentCard received`);

  // Step 3 — Layer 3: Signature verification (performed inside GARR resolve)
  console.log(`→ Verifying signature…`);
  console.log(`✓ Signature valid. Verified by: ${result.agent_card.signed_by}`);

  // Step 4 — Invocation metadata
  console.log(`→ A2A invocation_url: ${result.agent_card.invocation_url}`);
  console.log(`→ Simulating A2A call…`);
  console.log(`✓ Done.`);
}

async function main(): Promise<void> {
  console.log('GARR Demo — Layer 1 → Layer 2 → Layer 3 resolution flow');
  console.log(`Server: ${GARR_BASE}\n`);

  const locators = [
    'billing-agent@acme.demo:global',
    'inventory-agent@globex.demo:global',
    'hr-agent@initech.demo:global',
  ];

  for (const locator of locators) {
    await resolveAndPrint(locator);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('Demo complete.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
