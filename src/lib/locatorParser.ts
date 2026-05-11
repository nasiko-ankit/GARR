import { RESOLUTION_MODES } from '../types/api/resolve.js';
import type { ParsedLocator, ResolutionMode } from '../types/api/resolve.js';

/**
 * Parses an Agent Locator string into its three components (§15.1).
 *
 * Format: `<identifier>@<namespace>:<mode>`
 *   - mode     = everything after the last `:`
 *   - namespace = everything between the last `@` and the last `:`
 *   - identifier = everything before the last `@`
 *
 * The mode suffix is a binding instruction — never inferred (§15.3).
 *
 * @param raw - the raw locator string, e.g. "scheduler@nasiko.com:global"
 * @returns ParsedLocator with identifier, namespace, mode, and agentId
 * @throws Error with a descriptive message on any malformed input
 */
export function parseLocator(raw: string): ParsedLocator {
  const trimmed = raw.trim();

  // Extract mode from last ':'
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon === -1) {
    throw new Error(
      `invalid locator "${trimmed}": missing mode suffix (expected :global, :dnssrv, or :nandaindex.org)`,
    );
  }

  const modeRaw = trimmed.slice(lastColon + 1);
  const identityPart = trimmed.slice(0, lastColon);

  if (!RESOLUTION_MODES.includes(modeRaw as ResolutionMode)) {
    throw new Error(
      `invalid locator "${trimmed}": unknown mode ":${modeRaw}" — must be one of :global, :dnssrv, :nandaindex.org`,
    );
  }
  const mode = modeRaw as ResolutionMode;

  // Extract identifier and namespace from last '@'
  const atIdx = identityPart.lastIndexOf('@');
  if (atIdx === -1) {
    throw new Error(
      `invalid locator "${trimmed}": missing @ separator between identifier and namespace`,
    );
  }

  const identifier = identityPart.slice(0, atIdx);
  const namespace = identityPart.slice(atIdx + 1);

  if (!identifier) {
    throw new Error(`invalid locator "${trimmed}": identifier is empty`);
  }
  if (!namespace) {
    throw new Error(`invalid locator "${trimmed}": namespace is empty`);
  }

  return {
    identifier,
    namespace,
    mode,
    agentId: `${identifier}@${namespace}`,
  };
}