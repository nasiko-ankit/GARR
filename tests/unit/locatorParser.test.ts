import { describe, it, expect } from 'vitest';
import { parseLocator } from '../../src/lib/locatorParser.js';

describe('parseLocator', () => {

  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('parses :global locator', () => {
    const result = parseLocator('agent123@xyz.com:global');
    expect(result).toEqual({
      identifier: 'agent123',
      namespace:  'xyz.com',
      mode:       'global',
      agentId:    'agent123@xyz.com',
    });
  });

  it('trims surrounding whitespace', () => {
    const result = parseLocator('  agent123@xyz.com:global  ');
    expect(result.identifier).toBe('agent123');
    expect(result.namespace).toBe('xyz.com');
    expect(result.mode).toBe('global');
  });

  it('agentId is identifier@namespace without the mode suffix', () => {
    const { agentId } = parseLocator('refunds@jetblue.com:global');
    expect(agentId).toBe('refunds@jetblue.com');
  });

  it('handles subdomains in namespace', () => {
    const result = parseLocator('myagent@agents.nasiko.com:global');
    expect(result.identifier).toBe('myagent');
    expect(result.namespace).toBe('agents.nasiko.com');
  });

  // ── Error paths ─────────────────────────────────────────────────────────────

  it('throws on missing mode suffix (no colon)', () => {
    expect(() => parseLocator('agent123@xyz.com')).toThrow('missing mode suffix');
  });

  it('throws on unknown mode', () => {
    expect(() => parseLocator('agent123@xyz.com:http')).toThrow('unknown mode');
  });

  it('throws on removed :dnssrv mode', () => {
    expect(() => parseLocator('scheduler@nasiko.com:dnssrv')).toThrow('unknown mode');
  });

  it('throws on removed :nandaindex.org mode', () => {
    expect(() => parseLocator('agent@xyz.com:nandaindex.org')).toThrow('unknown mode');
  });

  it('throws on missing @ separator', () => {
    expect(() => parseLocator('agent123.xyz.com:global')).toThrow('missing @ separator');
  });

  it('throws on empty identifier', () => {
    expect(() => parseLocator('@xyz.com:global')).toThrow('identifier is empty');
  });

  it('throws on empty namespace', () => {
    expect(() => parseLocator('agent123@:global')).toThrow('namespace is empty');
  });

  it('throws on empty string', () => {
    expect(() => parseLocator('')).toThrow('missing mode suffix');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseLocator('   ')).toThrow('missing mode suffix');
  });
});
