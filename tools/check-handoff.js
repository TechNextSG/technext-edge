const baseUrl = 'https://technext-edge-casa-bff.vercel.app';

async function main() {
  const loginRes = await fetch(baseUrl + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=15586aabe0d26c6cae8489407a0a49450aaae801&next=%2Fhandoff',
    redirect: 'manual'
  });
  const cookie = loginRes.headers.get('set-cookie');
  const handoffRes = await fetch(baseUrl + '/handoff', {
    headers: { 'Cookie': cookie }
  });
  const html = await handoffRes.text();
  const phoneMatches = html.match(/handoff\/([^/"']+)\/(resume|reset)/g);
  console.log('Matches:', phoneMatches);
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g);
  console.log('Rows count:', rows ? rows.length : 0);
  if (rows) {
    for (const r of rows) {
      console.log('--- ROW ---');
      console.log(r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
  }
}

main().catch(console.error);
