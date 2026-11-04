// Run on the signed-in protected PR #6 Preview. Sends no training records.
// no-referrer with mode same-origin makes Origin null, exercising CSRF rejection.
// A red HTTP 403 in DevTools is the expected successful rejection.
(async () => {
  const expected = 'https://eric-health-hub-git-feature-stunna-sprint-1-stunna4.vercel.app';
  if (location.origin !== expected) throw new Error('Use the PR #6 Preview');
  const read = await fetch('/api/training', { cache: 'no-store' });
  if (read.status !== 200) throw new Error('Sign in first');
  const response = await fetch('/api/training', {
    method: 'POST',
    mode: 'same-origin',
    credentials: 'same-origin',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const body = await response.json();
  console.log(JSON.stringify({
    test: 'CSRF origin rejection',
    result: response.status === 403 && body.error === 'Invalid request origin' ? 'PASS' : 'FAIL',
    status: response.status,
    error: body.error
  }));
})().catch(error => console.error(error.message));
