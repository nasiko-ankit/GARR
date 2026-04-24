import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  requireEnv,
  optionalEnv,
  parsePositiveInt,
  buildConfig,
} from '../../src/config/index.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function mockExit() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return vi
    .spyOn(process, 'exit')
    .mockImplementation((_code?: string | number | null) => {
      throw new Error('__mock_exit__');
    });
}

describe('requireEnv', () => {
  it('returns the value when the var is set', () => {
    process.env.TEST_KEY = 'hello';
    expect(requireEnv('TEST_KEY')).toBe('hello');
  });

  it('exits with code 1 when the var is missing', () => {
    delete process.env.TEST_KEY;
    const exitSpy = mockExit();
    expect(() => requireEnv('TEST_KEY')).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when the var is blank/whitespace', () => {
    process.env.TEST_KEY = '   ';
    const exitSpy = mockExit();
    expect(() => requireEnv('TEST_KEY')).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('optionalEnv', () => {
  it('returns the value when set', () => {
    process.env.OPT_KEY = 'set';
    expect(optionalEnv('OPT_KEY', 'fallback')).toBe('set');
  });

  it('returns the fallback when unset', () => {
    delete process.env.OPT_KEY;
    expect(optionalEnv('OPT_KEY', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when blank', () => {
    process.env.OPT_KEY = '   ';
    expect(optionalEnv('OPT_KEY', 'fallback')).toBe('fallback');
  });
});

describe('parsePositiveInt', () => {
  it('parses a valid positive integer', () => {
    expect(parsePositiveInt('KEY', '42')).toBe(42);
  });

  it.each([['0'], ['-5'], ['abc'], ['3.14'], ['']])(
    'exits on invalid input: "%s"',
    (raw) => {
      const exitSpy = mockExit();
      expect(() => parsePositiveInt('KEY', raw)).toThrow('__mock_exit__');
      expect(exitSpy).toHaveBeenCalledWith(1);
    },
  );
});

describe('buildConfig', () => {
  it('applies defaults when only required vars are set', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';
    process.env.SIGNING_PRIVATE_KEY = 'signing-key';
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.SIGNING_KEY_ID;
    delete process.env.DB_MAX_CONNECTIONS;

    const cfg = buildConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.db.url).toBe('postgresql://u:p@localhost/db');
    expect(cfg.db.maxConnections).toBe(10);
    expect(cfg.signing.privateKey).toBe('signing-key');
    expect(cfg.signing.keyId).toBe('garr-dev-unspecified');
  });

  it('applies overrides from env', () => {
    process.env.DATABASE_URL = 'x';
    process.env.SIGNING_PRIVATE_KEY = 'y';
    process.env.PORT = '4000';
    process.env.NODE_ENV = 'production';
    process.env.SIGNING_KEY_ID = 'custom';
    process.env.DB_MAX_CONNECTIONS = '20';

    const cfg = buildConfig();
    expect(cfg.port).toBe(4000);
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.signing.keyId).toBe('custom');
    expect(cfg.db.maxConnections).toBe(20);
  });

  it('exits when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.SIGNING_PRIVATE_KEY = 'y';
    const exitSpy = mockExit();
    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when SIGNING_PRIVATE_KEY is missing', () => {
    process.env.DATABASE_URL = 'x';
    delete process.env.SIGNING_PRIVATE_KEY;
    const exitSpy = mockExit();
    expect(() => buildConfig()).toThrow('__mock_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
