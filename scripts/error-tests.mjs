// Probe each error path. Prints status + body for every negative case.
const API = 'http://localhost:3000';

async function show(label, method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(API + path, init);
  let j;
  try { j = await r.json(); } catch { j = '<no body>'; }
  console.log('\n[' + label + ']  ' + method + ' ' + path);
  console.log('  -> ' + r.status, JSON.stringify(j));
}

const baseValid = {
  display_name: 'X', contact_email: 'x@x.com',
  rap_url: 'https://www.cloudflare.com/',
  algorithm: 'ed25519',
  public_key: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----',
  key_id: 'k', ttl_seconds: 86400,
};

await show('400 schema — missing fields', 'POST', '/api/v1/register', {});
await show('400 schema — bad email', 'POST', '/api/v1/register', {
  ...baseValid, owner_id: 'bad-email-test', domain: 'wikipedia.org', contact_email: 'not-an-email',
});
await show('400 schema — non-HTTPS RAP URL', 'POST', '/api/v1/register', {
  ...baseValid, owner_id: 'http-rap-test', domain: 'wikipedia.org', rap_url: 'http://insecure.example/',
});
await show('422 dmarc_verification_failed', 'POST', '/api/v1/register', {
  ...baseValid, owner_id: 'no-dmarc-test', domain: 'nodmarc-test.invalid',
});
await show('422 rap_unreachable (RAP returns 500)', 'POST', '/api/v1/register', {
  ...baseValid, owner_id: 'rap-fail-test', domain: 'wikipedia.org', rap_url: 'https://httpbin.org/status/500',
});
await show('409 conflict — owner_id already exists', 'POST', '/api/v1/register', {
  ...baseValid, owner_id: 'github-demo', domain: 'wikipedia.org',
});
await show('409 conflict — domain already exists', 'POST', '/api/v1/register', {
  ...baseValid, owner_id: 'fresh-id', domain: 'github.com',
});
await show('404 owner not found', 'GET', '/api/v1/owners/this-owner-does-not-exist');
await show('404 verify with no pending', 'POST', '/api/v1/register/never-started/verify', { challenge_signature: 'AA==' });
await show('422 search query too short', 'GET', '/api/v1/search?q=a');
