// Run only on the signed-in protected PR #6 Preview with Network recording.
// Sends invalid text/plain, which the training API cannot persist.
// Verify the POST has Origin: null and HTTP 403 in Network.
(async () => {
  const expected = 'https://eric-health-hub-git-feature-stunna-sprint-1-stunna4.vercel.app';
  if (location.origin !== expected) throw new Error('Use the PR #6 Preview');
  const read = await fetch('/api/training', { cache: 'no-store' });
  if (read.status !== 200) throw new Error('Sign in first');
  const frame = document.createElement('iframe');
  frame.hidden = true;
  const timeout = setTimeout(() => {
    frame.remove();
    console.log('CSRF probe timed out; inspect Network, do not count as PASS');
  }, 15000);
  frame.onload = () => {
    try {
      if (frame.contentWindow.location.pathname !== '/api/training') return;
      const body = JSON.parse(frame.contentDocument.body.textContent);
      console.log(JSON.stringify({ test: 'CSRF form probe', response: body,
        verify: 'Network must show Origin: null and HTTP 403' }));
    } catch {
      console.log('Could not read probe response; inspect Network');
    }
    clearTimeout(timeout);
    frame.remove();
  };
  frame.srcdoc = '<meta name="referrer" content="no-referrer">' +
    '<form method="POST" action="/api/training" enctype="text/plain">' +
    '<input name="csrf_probe" value="invalid"></form>' +
    '<script>document.forms[0].submit()</script>';
  document.body.append(frame);
})().catch(error => console.error(error.message));
