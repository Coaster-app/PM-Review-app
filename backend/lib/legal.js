const db = require('../database');
const audit = require('./audit');

// The Terms of Service and Privacy Policy every person accepts before reaching the app — a
// clickwrap, as set out in docs/legal/v1.0/Coaster_Terms_of_Service_User_Acceptance_Plan.docx.
//
// The documents themselves are published, word for word, at the addresses below (frontend/public/
// legal/), and the originals are archived in docs/legal/<version>/. Publishing a new version:
// archive it, publish it at a new versioned address, and change the version here. Everyone is then
// asked to accept it at their next visit, and their earlier acceptances are kept.
//
// The Data Processing Addendum is for organizations and is signed through a customer agreement,
// not clicked through — an individual's click cannot bind their employer. It is linked from the
// acceptance screen for reference, and dpa_version is left empty on an individual's record.

const CURRENT = {
  terms: { version: '1.0', url: '/legal/terms-of-service-v1.0.html', title: 'Terms of Service' },
  privacy: { version: '1.0', url: '/legal/privacy-policy-v1.0.html', title: 'Privacy Policy' },
  dpa: { version: '1.0', url: '/legal/data-processing-addendum-v1.0.html', title: 'Data Processing Addendum' },
};

// The statement a person must tick. Shortened from the acceptance plan so the screen stays small,
// and one box rather than two: the plan's separate upload authorization read as distrust to a new
// user (Naren, November 2026). That promise is in the Terms themselves (Section 5, Your Content),
// which this box agrees to. The exact words shown are kept with each acceptance in the audit record.
const STATEMENTS = {
  terms: 'I agree to the Terms of Service and Privacy Policy, and I will check Coaster’s AI results before relying on them.',
};

// Whether this person has accepted the versions in force now.
function hasAccepted(userId) {
  return !!db.prepare(`
    SELECT 1 FROM legal_acceptances WHERE user_id = ? AND terms_version = ? AND privacy_version = ?
  `).get(userId, CURRENT.terms.version, CURRENT.privacy.version);
}

// Whether they have accepted any version before — so the screen can say "updated" rather than
// greet them as new.
const acceptedBefore = userId => !!db.prepare(`SELECT 1 FROM legal_acceptances WHERE user_id = ?`).get(userId);

function record(user, req, source) {
  db.prepare(`
    INSERT INTO legal_acceptances
      (user_id, email, terms_version, privacy_version, dpa_version, ip_address, user_agent, acceptance_source)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    user.id, String(user.email).toLowerCase(), CURRENT.terms.version, CURRENT.privacy.version,
    audit.ipOf(req), String(req.headers['user-agent'] || '').slice(0, 500) || null, source,
  );
  audit.record({
    action: 'terms_accepted', req, userId: user.id, email: user.email,
    detail: { terms: CURRENT.terms.version, privacy: CURRENT.privacy.version, source, statements: Object.values(STATEMENTS) },
  });
}

module.exports = { CURRENT, STATEMENTS, hasAccepted, acceptedBefore, record };
