// Run in the signed-in Sprint 2 Preview Console. GET requests only.
(async () => {
  const origin = 'https://eric-health-hub-git-feature-stunna-sprint-2-stunna4.vercel.app';
  if (location.origin !== origin) throw new Error('Use the protected Sprint 2 Preview');
  const cases = [
    { date: '2026-11-04', count: 1, titles: ['Full-body strength'], text: ['40 lb', '35 lb', 'Approved revision 2'] },
    { date: '2026-11-05', count: 2, titles: ['Demo run intervals', 'Demo combined-day strength'], text: ['3 rounds', 'Target RPE 6–7', 'per hand', 'Incline push-up', 'Optional'] },
    { date: '2026-11-06', count: 1, titles: ['Demo rowing intervals'], text: ['2:45–2:55 /500m', '20–22 spm', '400 m'] },
    { date: '2026-11-07', count: 1, titles: ['Scheduled workout'], text: ['No approved exercise prescription'] },
    { date: '2026-11-08', count: 1, titles: ['Demo cycling intervals'], text: ['120–160 W', '75–90 rpm', 'Easy spin'] }
  ];
  const checked = [];
  for (const item of cases) {
    const response = await fetch('/app?date=' + item.date, { credentials: 'same-origin', cache: 'no-store' });
    if (response.status !== 200) throw new Error(item.date + ': unexpected status ' + response.status);
    const document = new DOMParser().parseFromString(await response.text(), 'text/html');
    const main = document.querySelector('main');
    if (!main) throw new Error(item.date + ': missing app');
    const text = main.textContent.replace(/\s+/g, ' ');
    if (/Private training workspace|Training plan unavailable|Stunna is unavailable/.test(text)) {
      throw new Error('Sign in first, or report the visible application error');
    }
    const titles = [...main.querySelectorAll('h2')].map(element => element.textContent.trim());
    if (main.querySelectorAll('article').length !== item.count ||
        !item.titles.every(title => titles.includes(title)) ||
        !item.text.every(value => text.includes(value))) {
      throw new Error(item.date + ': synthetic prescription display mismatch');
    }
    if (!main.querySelector('nav[aria-label="Training calendar"] a[aria-current="date"]')) {
      throw new Error(item.date + ': selected calendar day missing');
    }
    checked.push(item.date);
  }
  console.log(JSON.stringify({ result: 'PASS', test: 'signed-in synthetic workout pages', dates: checked, requests: 'GET only' }));
})().catch(error => console.error(JSON.stringify({ result: 'FAIL', message: error.message })));
