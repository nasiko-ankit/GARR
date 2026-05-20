import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock node:dns BEFORE importing the module under test. vi.mock hoists,
// so the mock fn must be created via vi.hoisted to be referenceable inside
// the factory.
const { resolveTxt } = vi.hoisted(() => ({ resolveTxt: vi.fn() }));
vi.mock('node:dns', () => ({
  promises: { resolveTxt },
}));

import { verifyDmarcTxt } from '../../src/lib/dnsVerification.js';

function dnsError(code: string): NodeJS.ErrnoException {
  const err = new Error(`mock dns error: ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('verifyDmarcTxt', () => {
  beforeEach(() => {
    resolveTxt.mockReset();
  });

  it('returns the record when the direct host has DMARC1', async () => {
    resolveTxt.mockResolvedValueOnce([['v=DMARC1; p=reject']]);

    const result = await verifyDmarcTxt('example.com');

    expect(result).toBe('v=DMARC1; p=reject');
    expect(resolveTxt).toHaveBeenCalledTimes(1);
    expect(resolveTxt).toHaveBeenCalledWith('_dmarc.example.com');
  });

  it('falls back to the organizational domain on ENOTFOUND at subdomain', async () => {
    resolveTxt.mockRejectedValueOnce(dnsError('ENOTFOUND'));
    resolveTxt.mockResolvedValueOnce([['v=DMARC1; p=quarantine']]);

    const result = await verifyDmarcTxt('mail.example.com');

    expect(result).toBe('v=DMARC1; p=quarantine');
    expect(resolveTxt).toHaveBeenCalledTimes(2);
    expect(resolveTxt).toHaveBeenNthCalledWith(1, '_dmarc.mail.example.com');
    expect(resolveTxt).toHaveBeenNthCalledWith(2, '_dmarc.example.com');
  });

  it('throws and mentions both hosts when neither has a DMARC1 record', async () => {
    resolveTxt.mockRejectedValueOnce(dnsError('ENOTFOUND'));
    resolveTxt.mockRejectedValueOnce(dnsError('ENOTFOUND'));

    await expect(verifyDmarcTxt('mail.example.com')).rejects.toThrow(
      /_dmarc\.mail\.example\.com.*_dmarc\.example\.com/,
    );
    expect(resolveTxt).toHaveBeenCalledTimes(2);
  });

  it('falls back when the direct host returns only non-DMARC1 TXT records', async () => {
    resolveTxt.mockResolvedValueOnce([['v=spf1 -all'], ['something-else']]);
    resolveTxt.mockResolvedValueOnce([['v=DMARC1; p=none']]);

    const result = await verifyDmarcTxt('sub.example.com');

    expect(result).toBe('v=DMARC1; p=none');
    expect(resolveTxt).toHaveBeenCalledTimes(2);
  });

  it('does not recurse when the input is already a two-label domain', async () => {
    resolveTxt.mockRejectedValueOnce(dnsError('ENOTFOUND'));

    await expect(verifyDmarcTxt('example.com')).rejects.toThrow(
      'No DMARC TXT record found at _dmarc.example.com',
    );
    expect(resolveTxt).toHaveBeenCalledTimes(1);
  });
});