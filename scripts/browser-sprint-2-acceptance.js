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
  const today = await load('/app');
  assert(!today.querySelector('[data-workout-card]'), 'Intermediate workout cards remain');
  assert(today.querySelector('h1')?.textContent.trim() === 'Today’s workouts', 'Default route must open Today');
  for (const item of cases) {
    const home = await load('/app?date=' + item.date);
    assert(new URL(home.querySelector('nav[aria-label="Training calendar"] a[aria-current="date"]').getAttribute('href'), origin).searchParams.get('date') === item.date, 'Selected calendar date is incorrect');
    assert(!home.querySelector('[data-workout-card], a[href*="workout="]'), 'Intermediate workout navigation remains');
    const sections = [...home.querySelectorAll('[data-workout-overview]')];
    assert(sections.length === item.count, item.date + ': expected all workout overviews on the selected day');
    const statusIds = new Set();
    for (const section of sections) {
      assert(section.textContent.includes('Why this workout') && section.textContent.includes('Objective'), 'Overview summary is missing');
      const button = section.querySelector('button');
      assert(button?.disabled && button.textContent.trim() === 'Start Workout', 'Workout player must stay disabled');
      const statusId = button.getAttribute('aria-describedby');
      assert(statusId && !statusIds.has(statusId) && section.querySelector('[id="' + statusId + '"]'), 'Each workout needs its own Start Workout explanation');
      statusIds.add(statusId);
      const details = section.querySelector('details');
      assert(!details || !details.open, 'Prescription details should start collapsed');
      const article = section.querySelector('article');
      assert(article.lastElementChild.contains(button), 'Start Workout must be at the bottom of its overview');
      if (item.date !== '2026-11-07') {
        assert(section.textContent.includes('About ') && section.textContent.includes('RPE 6–7'), 'Authored overview metadata missing');
        assert(section.querySelector('ol') && section.textContent.includes('Adjustments & alternatives'), 'Plan structure or adjustment rules missing');
      } else {
        assert(section.textContent.includes('No approved exercise prescription'), 'Missing prescription state is absent');
      }
      overviews++;
    }
  }
  console.log(JSON.stringify({ result: 'PASS', test: 'Calendar and inline Workout Overviews', dates: cases.map(item => item.date), overviews, requests: 'GET only' }));
})().catch(error => console.error(JSON.stringify({ result: 'FAIL', message: error.message })));
