const assert = require('assert');

// The Terms of Service and Privacy Policy, accepted before anything else: nothing in the app
// answers until the statement is ticked; the acceptance is recorded with the versions, the
// time, the address and the browser; the record can be neither changed nor deleted, and outlives
// the account; and a new version asks again while keeping the earlier record.
//
//   DB_PATH=<scratch>/legal.db node tests/legalAcceptance.test.js      (use a fresh database file)

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireAuth, requireTerms } = require('../middleware/auth');
const legal = require('../lib/legal');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed += 1; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed += 1; }
}

const PASSWORD = 'harbour lantern 4417 copper';

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api', requireAuth);
  app.use('/api', requireTerms);
  app.use('/api/programs', require('../routes/programs'));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, { body, token, org } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'User-Agent': 'TestBrowser/1.0',
        'CF-Connecting-IP': '203.0.113.9',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(org ? { 'X-Org-Id': String(org) } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const userId = db.prepare(`INSERT INTO users (email, password_hash, name, status, email_verified_at) VALUES ('pat@brightline-mep.com', ?, 'Pat', 'Active', datetime('now'))`)
    .run(bcrypt.hashSync(PASSWORD, 4)).lastInsertRowid;
  const orgId = db.prepare(`INSERT INTO organizations (name) VALUES ('Brightline MEP')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'Contributor')`).run(orgId, userId);
  const login = await call('POST', '/auth/login', { body: { email: 'pat@brightline-mep.com', password: PASSWORD } });
  const token = login.body.token;

  await check('a new person signs in, but has not accepted yet', async () => {
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.body.user.termsAccepted, false);
    assert.strictEqual(login.body.user.termsUpdated, false);
  });

  await check('nothing in the app answers until they accept', async () => {
    const r = await call('GET', '/programs', { token, org: orgId });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.code, 'terms_required');
  });

  await check('the screen gets the documents and the one statement', async () => {
    const r = await call('GET', '/auth/legal');
    assert.strictEqual(r.body.documents.terms.version, '1.0');
    assert.strictEqual(r.body.documents.privacy.url, '/legal/privacy-policy-v1.0.html');
    assert.match(r.body.statements.terms, /^I agree to the Terms of Service and Privacy Policy/);
    assert.deepStrictEqual(Object.keys(r.body.statements), ['terms'], 'one box only');
  });

  await check('the box must be ticked', async () => {
    for (const body of [{}, { agree_terms: false }, { agree_terms: 'yes' }]) {
      assert.strictEqual((await call('POST', '/auth/accept-terms', { token, body })).status, 400, JSON.stringify(body));
    }
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM legal_acceptances`).get().n, 0);
  });

  await check('only by the person themselves', async () => {
    assert.strictEqual((await call('POST', '/auth/accept-terms', { body: { agree_terms: true} })).status, 401);
  });

  await check('accepting is recorded with every field, and lets them in', async () => {
    const r = await call('POST', '/auth/accept-terms', { token, body: { agree_terms: true} });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.termsAccepted, true);
    const rec = db.prepare(`SELECT * FROM legal_acceptances WHERE user_id = ?`).get(userId);
    assert.strictEqual(rec.email, 'pat@brightline-mep.com');
    assert.deepStrictEqual([rec.terms_version, rec.privacy_version, rec.dpa_version], ['1.0', '1.0', null]);
    assert.match(rec.accepted_at_utc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.strictEqual(rec.ip_address, '203.0.113.9');
    assert.strictEqual(rec.user_agent, 'TestBrowser/1.0');
    assert.strictEqual(rec.acceptance_source, 'acceptance prompt');
    assert.strictEqual((await call('GET', '/programs', { token, org: orgId })).status, 200);
    assert.strictEqual((await call('GET', '/auth/me', { token })).body.user.termsAccepted, true);
  });

  await check('accepting twice records once', async () => {
    await call('POST', '/auth/accept-terms', { token, body: { agree_terms: true} });
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM legal_acceptances WHERE user_id = ?`).get(userId).n, 1);
  });

  await check('the record cannot be changed or deleted', async () => {
    assert.throws(() => db.prepare(`UPDATE legal_acceptances SET terms_version = '0.9'`).run(), /cannot be changed/);
    assert.throws(() => db.prepare(`DELETE FROM legal_acceptances`).run(), /cannot be deleted/);
  });

  await check('a new version asks again, says it is an update, and keeps the earlier record', async () => {
    const was = legal.CURRENT.terms.version;
    legal.CURRENT.terms.version = '1.1';
    try {
      const me = await call('GET', '/auth/me', { token });
      assert.deepStrictEqual([me.body.user.termsAccepted, me.body.user.termsUpdated], [false, true]);
      assert.strictEqual((await call('GET', '/programs', { token, org: orgId })).status, 403);
      await call('POST', '/auth/accept-terms', { token, body: { agree_terms: true} });
      const recs = db.prepare(`SELECT terms_version, acceptance_source FROM legal_acceptances WHERE user_id = ? ORDER BY id`).all(userId);
      assert.deepStrictEqual(recs.map(r => [r.terms_version, r.acceptance_source]), [['1.0', 'acceptance prompt'], ['1.1', 're-acceptance prompt']]);
      assert.strictEqual((await call('GET', '/programs', { token, org: orgId })).status, 200);
    } finally {
      legal.CURRENT.terms.version = was;
    }
  });

  await check('the record outlives the account', async () => {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM legal_acceptances WHERE email = 'pat@brightline-mep.com'`).get().n, 2);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
