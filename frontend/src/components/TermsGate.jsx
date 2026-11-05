import { useEffect, useState } from 'react';
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { authApi } from '../api';

// Nothing in the app until the person has accepted the current Terms of Service and Privacy
// Policy — the clickwrap in docs/legal/. One unticked statement, and an "I Agree" that stays off
// until it is ticked. The documents open here, word for word, for
// anyone who wants to read them before agreeing; nobody is made to scroll through them.
//
// The server enforces the same thing (middleware requireTerms), so this screen is the way
// through, not the lock.
export default function TermsGate({ children }) {
  const [state, setState] = useState(() => (authApi.user()?.termsAccepted === true ? 'ok' : 'checking'));
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    const check = () => authApi.me()
      .then(({ user }) => { setUpdated(!!user.termsUpdated); setState(user.termsAccepted ? 'ok' : 'needed'); })
      .catch(() => {});
    if (state === 'checking') check();
    // A new version published while they were signed in: the server says so on the next request.
    const onRequired = () => check();
    window.addEventListener('coaster:terms-required', onRequired);
    return () => window.removeEventListener('coaster:terms-required', onRequired);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'ok') return children;
  if (state === 'checking') return null;
  return <Acceptance updated={updated} onAccepted={() => setState('ok')} />;
}

function Acceptance({ updated, onAccepted }) {
  const [legal, setLegal] = useState(null);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [reading, setReading] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authApi.legal().then(setLegal).catch(() => setError('Could not load the terms. Refresh the page to try again.'));
  }, []);

  const agree = async () => {
    setError(''); setSaving(true);
    try {
      await authApi.acceptTerms({ agree_terms: agreeTerms });
      onAccepted();
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not record your acceptance. Try again.');
      setSaving(false);
    }
  };
  const signOut = () => { authApi.logout(); window.location.href = '/login'; };

  const docs = legal ? [legal.documents.terms, legal.documents.privacy] : [];
  const dpa = legal?.documents.dpa;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #fbf7f2 0%, #eef1f8 100%)' }}>
      <div className="w-full flex flex-col"
        style={{
          maxWidth: reading ? 820 : 420, maxHeight: '92vh', background: '#fff', borderRadius: 18,
          border: '1px solid #e8edf2', boxShadow: '0 24px 64px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
        }}>
        {reading ? (
          <>
            <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: '1px solid #f3f4f6' }}>
              <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setReading(null)}>
                <ArrowLeftIcon className="w-4 h-4" /> Back
              </button>
              <span className="text-sm font-semibold text-gray-900 truncate">{reading.title}</span>
              <a className="btn-secondary px-2.5 py-1 text-xs" href={reading.url} target="_blank" rel="noreferrer">
                Open in a new tab <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </a>
            </div>
            <iframe title={reading.title} src={reading.url} className="w-full flex-1"
              style={{ minHeight: '70vh', border: 0, borderRadius: '0 0 18px 18px' }} />
          </>
        ) : (
          <div className="p-6 overflow-y-auto space-y-4">
            <div className="flex items-center gap-3">
              <img src="/coaster-logo.svg" alt="Coaster" className="w-8 h-8 rounded-lg flex-shrink-0" />
              <h1 className="text-base font-semibold text-gray-900">
                {updated ? 'Our terms have been updated' : 'Before you start'}
              </h1>
            </div>

            <Statement checked={agreeTerms} onChange={setAgreeTerms} text={legal?.statements.terms} docs={docs} onRead={setReading} />

            {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}

            <div className="flex items-center justify-between gap-3">
              <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={signOut}>Sign out</button>
              <button className="btn-primary" onClick={agree} disabled={!legal || !agreeTerms || saving}>
                {saving ? 'Saving…' : 'I Agree'}
              </button>
            </div>

            {dpa && (
              <p className="text-[11px] text-gray-400 text-center">
                Organizations: see the{' '}
                <button type="button" className="underline" onClick={() => setReading(dpa)}>{dpa.title}</button>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One statement and its tick box. Where the statement names a document, the name opens it.
function Statement({ checked, onChange, text, docs = [], onRead }) {
  if (!text) return null;
  const parts = [];
  let rest = text;
  for (;;) {
    const hit = docs.map(d => ({ d, at: rest.indexOf(d.title) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (!hit) { parts.push(rest); break; }
    parts.push(rest.slice(0, hit.at));
    parts.push(
      <button key={hit.d.url} type="button" className="underline font-medium" style={{ color: '#1d4ed8' }}
        onClick={e => { e.preventDefault(); onRead(hit.d); }}>
        {hit.d.title}
      </button>,
    );
    rest = rest.slice(hit.at + hit.d.title.length);
  }
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" className="mt-0.5 flex-shrink-0" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="text-sm text-gray-700 leading-snug">{parts}</span>
    </label>
  );
}
