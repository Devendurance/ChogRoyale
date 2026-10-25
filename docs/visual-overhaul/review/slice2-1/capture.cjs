// Visual overhaul v3 slice 2.1: two-perspective orientation captures.
// Presentation fixture only (temporary qa-v2 harness + recorded local-engine
// snapshots). Proves canvas orientation, colours and defender facing, never a
// live two-login match, auth, settlement or a physical device.
const { chromium } = require('C:/Users/USER/Documents/ideas/chog-royale/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const fixture = fs.readFileSync('C:/Users/USER/Documents/ChogRoyale-Assets/battle-experience-v2-20261025/local-engine-transitions.json');
const label = process.env.LABEL || 'after';
const out = path.join(__dirname, label);
fs.mkdirSync(out, { recursive: true });
const sizes = (process.env.SIZES || '390x844,1366x768').split(',').map((s) => s.split('x').map(Number));
const people = [['endy', 1], ['phantom', 0]];
(async () => {
  const browser = await chromium.launch();
  const evidence = [];
  for (const [w, h] of sizes) for (const [who, seat] of people) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const failed = [];
    page.on('requestfailed', (r) => failed.push(r.url()));
    page.on('response', (r) => { if (r.status() >= 400 && /\/assets\//.test(r.url()) && !(process.env.FALLBACK && /v003\/manifests/.test(r.url()))) failed.push(`${r.status()} ${r.url()}`); });
    await page.route('**/qa-fixture.json', (r) => r.fulfill({ contentType: 'application/json', body: fixture }));
    // FALLBACK=1 proves the v002 arena still loads when the v003 manifest is unavailable.
    if (process.env.FALLBACK) await page.route('**/chaos-crossing/v003/manifests/arena.runtime.json', (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto(`http://127.0.0.1:3000/dev/battle/qa-v2?view=active&who=${who}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => window.__battleGame?.scene.scenes.some((s) => s.sys.isActive() && s.load.progress === 1 && s.children.list.length > 10), { timeout: 240000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.addStyleTag({ content: 'nextjs-portal{display:none}' });
    await page.waitForTimeout(800);
    const probe = await page.evaluate(() => {
      const scene = window.__battleGame.scene.scenes.find((s) => s.sys.isActive());
      const imgs = [];
      const walk = (list, parent) => { for (const o of list) { if (o.list) walk(o.list, o); else if (o.texture) imgs.push({ key: o.texture.key, flipY: !!o.flipY, tint: o.tintTopLeft ?? null, cropY: o.isCropped ? o._crop?.y ?? null : null, visible: o.visible, y: Math.round(parent ? parent.y : o.y), x: Math.round(parent ? parent.x : o.x) }); } };
      walk(scene.children.list, null);
      return {
        layers: imgs.filter((i) => i.key.startsWith('arena:layer:')).map((i) => ({ key: i.key.replace('arena:layer:', ''), flipY: i.flipY, tint: i.tint?.toString(16), visible: i.visible })),
        defenders: imgs.filter((i) => i.key.includes(':defender-') && i.visible).map((i) => ({ pose: i.key, x: i.x, y: i.y, half: i.y > 400 ? 'bottom' : 'top' })),
      };
    });
    const canvas = await page.$('[data-testid="battle-board"] canvas');
    const name = `active-${who}-seat${seat}-${w}x${h}.png`;
    await page.screenshot({ path: path.join(out, name) });
    if (canvas) await canvas.screenshot({ path: path.join(out, `board-${who}-seat${seat}-${w}x${h}.png`) });
    evidence.push({ name, who, seat, viewport: [w, h], errors, failed, ...probe });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 1));
  for (const e of evidence) console.log(e.name, 'errors', e.errors.length, 'failed', e.failed.length, 'defenders', e.defenders.map((d) => `${d.half}:${d.pose.split(':').pop()}`).join(','));
})().catch((e) => { console.error(e); process.exit(1); });
