import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const CH_BASE = 'https://api.company-information.service.gov.uk';
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── 1. FETCH RAW DATA FROM COMPANIES HOUSE ───────────────────────────────────

export async function fetchCompanyProfile(number) {
  const apiKey = process.env.CH_API_KEY;
  if (!apiKey) {
    console.error('CH_API_KEY not set');
    const e = new Error('Companies House is unavailable — please retry shortly');
    e.status = 503; throw e;
  }

  const auth = Buffer.from(apiKey + ':').toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  console.log(`Fetching CH data for ${number}...`);

  const [p, o, f, c, s] = await Promise.all([
    chFetch(`/company/${number}`, headers),
    chFetch(`/company/${number}/officers?items_per_page=100`, headers),
    chFetch(`/company/${number}/filing-history?items_per_page=50`, headers),
    chFetch(`/company/${number}/charges`, headers),
    chFetch(`/company/${number}/persons-with-significant-control`, headers),
  ]);

  if (!p.ok && p.status === 404) {
    const e = new Error(`Company ${number} not found on the Companies House register`);
    e.status = 404; throw e;
  }
  if (!p.ok) {
    const e = new Error('Companies House is unavailable — please retry shortly');
    e.status = 503; throw e;
  }
  // Sub-resources may legitimately 404 (e.g. no charges registered)
  const val = r => (r.ok ? r.data : null);
  return { profile: p.data, officers: val(o), filing: val(f), charges: val(c), pscs: val(s) };
}

async function chFetch(path, headers) {
  try {
    const res = await fetch(CH_BASE + path, { headers });
    if (res.status === 404) { return { ok: false, status: 404 }; }
    if (!res.ok) {
      console.error(`CH ${res.status}: ${path}${res.status === 401 ? ' — check CH_API_KEY' : ''}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    console.error(`CH fetch error for ${path}:`, err.message);
    return { ok: false, status: 0 };
  }
}

// ── 2. DETERMINISTIC RISK SCORING ────────────────────────────────────────────

export function computeRiskSignals(raw) {
  const { profile, officers, filing, charges, pscs } = raw;
  const signals = [];
  let score = 0;

  if (!profile) return { score: 0, signals: [] };

  const status = profile?.company_status;
  if (status === 'active') {
    signals.push({ type: 'ok', icon: '✓', text: 'Company status: Active' });
  } else if (status === 'dissolved') {
    score += 50; signals.push({ type: 'red', icon: '✗', text: 'DISSOLVED — company no longer exists', weight: 50 });
  } else if (['liquidation', 'receivership', 'administration'].includes(status)) {
    score += 45; signals.push({ type: 'red', icon: '✗', text: `Status: ${status} — insolvency proceedings active`, weight: 45 });
  } else {
    score += 20; signals.push({ type: 'warn', icon: '⚠', text: `Status: ${status || 'unknown'}`, weight: 20 });
  }

  if (profile?.date_of_creation) {
    const ageYears = (Date.now() - new Date(profile.date_of_creation)) / (1000 * 60 * 60 * 24 * 365.25);
    if (ageYears < 1) { score += 20; signals.push({ type: 'red', icon: '✗', text: 'Incorporated less than 12 months', weight: 20 }); }
    else if (ageYears < 2) { score += 12; signals.push({ type: 'warn', icon: '⚠', text: `Young company — ${Math.floor(ageYears * 12)} months incorporated`, weight: 12 }); }
    else if (ageYears < 5) { score += 6; signals.push({ type: 'warn', icon: '⚠', text: `${Math.floor(ageYears)} years incorporated`, weight: 6 }); }
    else { signals.push({ type: 'ok', icon: '✓', text: `Established — ${Math.floor(ageYears)} years incorporated` }); }
  }

  const nextAccounts = profile?.accounts?.next_due;
  if (nextAccounts) {
    const daysOverdue = (Date.now() - new Date(nextAccounts)) / 86400000;
    if (daysOverdue > 60) { score += 25; signals.push({ type: 'red', icon: '✗', text: `Accounts overdue ${Math.floor(daysOverdue)} days`, weight: 25 }); }
    else if (daysOverdue > 0) { score += 15; signals.push({ type: 'warn', icon: '⚠', text: `Accounts overdue ${Math.floor(daysOverdue)} days`, weight: 15 }); }
    else { signals.push({ type: 'ok', icon: '✓', text: 'Accounts filing up to date' }); }
  }

  if (profile?.confirmation_statement?.overdue) {
    score += 10; signals.push({ type: 'warn', icon: '⚠', text: 'Confirmation statement overdue', weight: 10 });
  }

  const outstanding = (charges?.items || []).filter(c => c.status === 'outstanding').length;
  if (outstanding > 8) { score += 8; signals.push({ type: 'warn', icon: '⚠', text: `${outstanding} outstanding charges`, weight: 8 }); }
  else if (outstanding > 0) { signals.push({ type: 'ok', icon: '✓', text: `${outstanding} outstanding charges (normal)` }); }
  else { signals.push({ type: 'ok', icon: '✓', text: 'No outstanding charges' }); }

  const allOfficers = officers?.items || [];
  const activeDirectors = allOfficers.filter(o => o.officer_role === 'director' && !o.resigned_on);
  const recentResignations = allOfficers.filter(o => {
    if (!o.resigned_on || o.officer_role !== 'director') return false;
    return (Date.now() - new Date(o.resigned_on)) / 86400000 < 365;
  });

  if (activeDirectors.length === 0) { score += 20; signals.push({ type: 'red', icon: '✗', text: 'No active directors on record', weight: 20 }); }
  else if (recentResignations.length >= 3) { score += 12; signals.push({ type: 'warn', icon: '⚠', text: `${recentResignations.length} director resignations in last 12 months`, weight: 12 }); }
  else { signals.push({ type: 'ok', icon: '✓', text: `${activeDirectors.length} active directors` }); }

  const pscItems = pscs?.items || [];
  const activePscs = pscItems.filter(p => !p.ceased_on);
  if (activePscs.length === 0 && !pscItems.some(p => p.kind?.includes('super-secure'))) {
    score += 15; signals.push({ type: 'warn', icon: '⚠', text: 'No PSC recorded — ownership unclear', weight: 15 });
  } else {
    signals.push({ type: 'ok', icon: '✓', text: `${activePscs.length} PSC(s) on record` });
  }

  const gazetteNotice = (filing?.items || []).some(f => f.type?.includes('GAZ') || f.description?.toLowerCase().includes('gazette'));
  if (gazetteNotice) { score += 30; signals.push({ type: 'red', icon: '✗', text: 'Gazette or dissolution notice filed', weight: 30 }); }

  return { score: Math.min(Math.round(score), 100), signals };
}

// ── 3. CLAUDE SYNTHESIS ───────────────────────────────────────────────────────

export async function scoreRisk(raw) {
  const { profile, officers, filing, charges, pscs } = raw;

  if (!profile) {
    const e = new Error('Companies House data unavailable');
    e.status = 503; throw e;
  }

  const { score, signals } = computeRiskSignals(raw);
  const riskLevel = score < 30 ? 'low' : score < 60 ? 'medium' : 'high';

  const dataSummary = {
    company: {
      name: profile?.company_name,
      number: profile?.company_number,
      status: profile?.company_status,
      type: profile?.type,
      created: profile?.date_of_creation,
      address: [profile?.registered_office_address?.address_line_1, profile?.registered_office_address?.locality, profile?.registered_office_address?.postal_code].filter(Boolean).join(', '),
      sic_codes: profile?.sic_codes,
      accounts_next_due: profile?.accounts?.next_due,
      accounts_last_made_up: profile?.accounts?.last_accounts?.made_up_to,
    },
    directors: {
      active: (officers?.items || []).filter(o => o.officer_role === 'director' && !o.resigned_on).map(o => ({ name: o.name, appointed: o.appointed_on })),
      recent_resignations: (officers?.items || []).filter(o => o.resigned_on && o.officer_role === 'director' && (Date.now() - new Date(o.resigned_on)) / 86400000 < 365).map(o => ({ name: o.name, resigned: o.resigned_on })),
    },
    charges: {
      outstanding: (charges?.items || []).filter(c => c.status === 'outstanding').length,
      satisfied: (charges?.items || []).filter(c => c.status === 'fully-satisfied').length,
    },
    pscs: (pscs?.items || []).map(p => ({ name: p.name, kind: p.kind, nature: p.natures_of_control, ceased: p.ceased_on })),
    recent_filings: (filing?.items || []).slice(0, 8).map(f => ({ type: f.type, date: f.date, description: f.description?.slice(0, 60) })),
  };

  const prompt = `You are a UK company risk analyst. Return ONLY valid JSON, no markdown.

RISK SCORE (do not change): ${score}/100
RISK LEVEL: ${riskLevel}
SIGNALS: ${JSON.stringify(signals)}
DATA: ${JSON.stringify(dataSummary)}

JSON shape:
{
  "company_number": "${profile?.company_number}",
  "company_name": "string",
  "status": "string",
  "incorporated": "YYYY-MM-DD",
  "sic_codes": ["string"],
  "registered_address": "string",
  "risk_score": ${score},
  "risk_level": "${riskLevel}",
  "health_summary": "2-4 sentences with specific facts",
  "flags": [{"type":"ok|warn|red","icon":"✓|⚠|✗","text":"string"}],
  "data": [{"label":"string","value":"string"}],
  "ownership": "1-2 sentences",
  "recommendation": "one direct actionable sentence",
  "director_disqualifications": "None identified or details"
}`;

  try {
    const msg = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    parsed.risk_score = score;
    parsed.risk_level = riskLevel;
    parsed._source = 'companies-house';
    delete parsed._live;
    return parsed;
  } catch (err) {
    console.error('Claude synthesis failed, returning deterministic profile:', err.message);
    return {
      company_number: profile.company_number,
      company_name: profile.company_name,
      status: profile.company_status,
      incorporated: profile.date_of_creation,
      sic_codes: profile.sic_codes || [],
      registered_address: dataSummary.company.address,
      risk_score: score,
      risk_level: riskLevel,
      health_summary: `Risk score ${score}/100 (${riskLevel}) computed from Companies House records.`,
      flags: signals,
      data: [],
      ownership: `${dataSummary.pscs.length} PSC record(s) on file`,
      recommendation: score >= 60 ? 'High risk — do not proceed without full due diligence.'
        : score >= 30 ? 'Moderate risk — request latest accounts and references before committing.'
        : 'Low risk — proceed with standard commercial terms.',
      director_disqualifications: 'Not checked',
      _source: 'companies-house',
    };
  }
}
