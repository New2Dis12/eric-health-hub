// Run in the signed-in Sprint 2 Preview Console. GET requests only.
(async () => {
  const origin = 'https://eric-health-hub-git-feature-stunna-sprint-2-stunna4.vercel.app';
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(location.origin === origin, 'Use the protected Sprint 2 Preview');
  const load = async path => {
    const url = new URL(path, origin);
    assert(url.origin === origin && url.pathname === '/app', 'Unexpected navigation target');
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    assert(response.status === 200, 'Unexpected page status ' + response.status);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const main = doc.querySelector('main');
    assert(main && main.querySelector('nav[aria-label="Training calendar"] a[aria-current="date"]'), 'Sign in first or report the application error');
    assert(!main.querySelector('input, textarea, select, [contenteditable="true"]'), 'Unexpected data-entry control');
    assert(!/\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(main.textContent), 'Scheduled clock time is displayed');
    return main;
  };
  const cases = [
    { date: '2026-11-04', count: 1 },
    { date: '2026-11-05', count: 2 },
    { date: '2026-11-06', count: 1 },
    { date: '2026-11-07', count: 1 },
    { date: '2026-11-08', count: 1 }
  ];
  let overviews = 0;
  for (const item of cases) {
    const home = await load('/app?date=' + item.date);
    const cards = [...home.querySelectorAll('[data-workout-card]')];
    assert(cards.length === item.count, item.date + ': unexpected workout count');
    assert(!home.querySelector('[data-workout-overview]'), 'Home unexpectedly opened an overview');
    for (const card of cards) {
      const link = card.querySelector('a[href]');
      assert(link, 'Missing workout navigation');
      const overview = await load(link.getAttribute('href'));
      const section = overview.querySelector('[data-workout-overview]');
      assert(section && section.textContent.includes('Why this workout'), 'Overview is missing');
      const button = section.querySelector('button');
      assert(button?.disabled && button.textContent.trim() === 'Start Workout', 'Workout player must stay disabled');
      assert(section.querySelector('a[href="/app?date=' + item.date + '"]'), 'Back navigation must preserve selected date');
      const details = section.querySelector('details');
      assert(!details || !details.open, 'Execution details should start collapsed');
      if (item.date !== '2026-11-07') {
        assert(section.textContent.includes('About ') && section.textContent.includes('RPE 6–7'), 'Authored overview metadata missing');
      } else {
        assert(section.textContent.includes('No approved exercise prescription'), 'Missing prescription state is absent');
      }
      overviews++;
    }
  }
  console.log(JSON.stringify({ result: 'PASS', test: 'Home to Workout Overview', dates: cases.map(item => item.date), overviews, requests: 'GET only' }));
})().catch(error => console.error(JSON.stringify({ result: 'FAIL', message: error.message })));
