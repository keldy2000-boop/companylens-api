import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const CH_BASE = 'https://api.company-information.service.gov.uk';
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── 1. FETCH RAW DATA FROM COMPANIES HOUSE ───────────────────────────────────

export async function fetchCompanyProfile(number) {
  const auth = Buffer.from(process.env.CH_API_KEY + ':').toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  const [profile, officers, filing, charges, pscs] = await Promise.all([
    chFetch(`/company/${number}`, headers),
    chFetch(`/company/${number}/officers?items_per_page=100`, headers),
    chFetch(`/company/${number}/filing-history?items_per_page=50`, headers),
    chFetch(`/company/${number}/charges`, headers),
    chFetch(`/company/${number}/persons-with-significant-control`, headers),
  ]);

  return { profile, officers, filing, charges, pscs };
}

async function chFetch(path, headers) {
  try {
    const res = await fetch(CH_BASE + path, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CH API ${res.status}: ${path}`);
    return res.json();
  } catch {
    return null;
  }
}

// ── 2. DETERMINISTIC RISK SCORING ────────────────────────────────────────────
// Produces structured signals with numeric weights.
// Score: 0 (lowest risk) → 100 (highest risk).
// Claude cannot override the score — it only synthesises the output.

export function computeRiskSignals(raw) {
  const { profile, officers, filing, charges, pscs } = raw;
  const signals = [];
  let score = 0;

  // ── Company status ────────────────────────────────────────────
  const status = profile?.company_status;
  if (status === 'active') {
    signals.push({ type: 'ok', icon: '✓', text: 'Company status: Active' });
  } else if (status === 'dissolved') {
    score += 50;
    signals.push({ type: 'red', icon: '✗', text: 'DISSOLVED — company no longer exists', weight: 50 });
  } else if (['liquidation', 'receivership', 'administration'].includes(status)) {
    score += 45;
    signals.push({ type: 'red', icon: '✗', text: `Status: ${status} — insolvency proceedings active`, weight: 45 });
  } else {
    score += 20;
    signals.push({ type: 'warn', icon: '⚠', text: `Status: ${status || 'unknown'}`, weight: 20 });
  }

  // ── Company age ───────────────────────────────────────────────
  if (profile?.date_of_creation) {
    const incDate = new Date(profile.date_of_creation);
    const ageYears = (Date.now() - incDate) / (1000 * 60 * 60 * 24 * 365.25);
    if (ageYears < 1) {
      score += 20;
      signals.push({ type: 'red', icon: '✗', text: 'Incorporated less than 12 months — very limited trading history', weight: 20 });
    } else if (ageYears < 2) {
      score += 12;
      signals.push({ type: 'warn', icon: '⚠', text: `Young company — ${Math.floor(ageYears * 12)} months trading history`, weight: 12 });
    } else if (ageYears < 5) {
      score += 6;
      signals.push({ type: 'warn', icon: '⚠', text: `Limited history — ${Math.floor(ageYears)} years incorporated`, weight: 6 });
    } else {
      signals.push({ type: 'ok', icon: '✓', text: `Established — ${Math.floor(ageYears)} years incorporated` });
    }
  }

  // ── Accounts filing ───────────────────────────────────────────
  const nextAccounts = profile?.accounts?.next_due;
  const lastMadeUp = profile?.accounts?.last_accounts?.made_up_to;
  if (nextAccounts) {
    const daysOverdue = (Date.now() - new Date(nextAccounts)) / 86400000;
    if (daysOverdue > 60) {
      score += 25;
      signals.push({ type: 'red', icon: '✗', text: `Accounts significantly overdue — ${Math.floor(daysOverdue)} days past due date`, weight: 25 });
    } else if (daysOverdue > 0) {
      score += 15;
      signals.push({ type: 'warn', icon: '⚠', text: `Accounts overdue by ${Math.floor(daysOverdue)} days`, weight: 15 });
    } else {
      signals.push({ type: 'ok', icon: '✓', text: `Accounts up to date${lastMadeUp ? ` — last made up to ${lastMadeUp}` : ''}` });
    }
  }

  // ── Confirmation statement ────────────────────────────────────
  if (profile?.confirmation_statement?.overdue === true) {
    score += 10;
    signals.push({ type: 'warn', icon: '⚠', text: 'Confirmation statement overdue', weight: 10 });
  } else if (profile?.confirmation_statement?.next_due) {
    signals.push({ type: 'ok', icon: '✓', text: 'Confirmation statement current' });
  }

  // ── Outstanding charges ───────────────────────────────────────
  const chargeItems = charges?.items || [];
  const outstanding = chargeItems.filter(c => c.status === 'outstanding');
  const satisfied = chargeItems.filter(c => c.status === 'fully-satisfied');
  if (outstanding.length > 8) {
    score += 8;
    signals.push({ type: 'warn', icon: '⚠', text: `${outstanding.length} outstanding charges — elevated for company size`, weight: 8 });
  } else if (outstanding.length > 0) {
    signals.push({ type: 'ok', icon: '✓', text: `${outstanding.length} outstanding charge${outstanding.length > 1 ? 's' : ''} (normal for trading company with finance facilities)` });
  } else {
    signals.push({ type: 'ok', icon: '✓', text: `No outstanding charges${satisfied.length > 0 ? ` — ${satisfied.length} previously satisfied` : ''}` });
  }

  // ── Directors ─────────────────────────────────────────────────
  const allOfficers = officers?.items || [];
  const activeDirectors = allOfficers.filter(o =>
    o.officer_role === 'director' && !o.resigned_on
  );
  const recentResignations = allOfficers.filter(o => {
    if (!o.resigned_on) return false;
    const daysAgo = (Date.now() - new Date(o.resigned_on)) / 86400000;
    return o.officer_role === 'director' && daysAgo < 365;
  });

  if (activeDirectors.length === 0) {
    score += 20;
    signals.push({ type: 'red', icon: '✗', text: 'No active directors on record', weight: 20 });
  } else if (recentResignations.length >= 3) {
    score += 12;
    signals.push({ type: 'warn', icon: '⚠', text: `${recentResignations.length} director resignations in last 12 months — elevated turnover`, weight: 12 });
  } else if (recentResignations.length >= 1) {
    score += 4;
    signals.push({ type: 'warn', icon: '⚠', text: `${recentResignations.length} director resignation${recentResignations.length > 1 ? 's' : ''} in last 12 months`, weight: 4 });
  } else {
    signals.push({ type: 'ok', icon: '✓', text: `${activeDirectors.length} active director${activeDirectors.length > 1 ? 's' : ''} — stable structure` });
  }

  // ── PSC (ownership transparency) ─────────────────────────────
  const pscItems = pscs?.items || [];
  const activePscs = pscItems.filter(p => !p.ceased_on);
  const hasSuperSecure = pscItems.some(p =>
    p.kind === 'super-secure-persons-with-significant-control'
  );
  if (hasSuperSecure || (pscs?.links?.persons_with_significant_control_statements)) {
    signals.push({ type: 'ok', icon: '✓', text: 'PSC exemption in place (listed company or equivalent)' });
  } else if (activePscs.length === 0) {
    score += 15;
    signals.push({ type: 'warn', icon: '⚠', text: 'No PSC recorded — beneficial ownership not transparent', weight: 15 });
  } else {
    signals.push({ type: 'ok', icon: '✓', text: `${activePscs.length} active PSC${activePscs.length > 1 ? 's' : ''} — ownership on record` });
  }

  // ── Gazette / dissolution notices ─────────────────────────────
  const filingItems = filing?.items || [];
  const gazetteNotice = filingItems.some(f =>
    f.type?.includes('GAZ') ||
    f.description?.toLowerCase().includes('gazette') ||
    f.description?.toLowerCase().includes('dissolution')
  );
  if (gazetteNotice) {
    score += 30;
    signals.push({ type: 'red', icon: '✗', text: 'Gazette or dissolution notice in recent filings — company may be closing', weight: 30 });
  }

  // ── Dormant status ────────────────────────────────────────────
  if (profile?.company_status_detail?.includes('dormant')) {
    score += 5;
    signals.push({ type: 'warn', icon: '⚠', text: 'Company is dormant — no active trading', weight: 5 });
  }

  return {
    score: Math.min(Math.round(score), 100),
    signals,
  };
}

// ── 3. CLAUDE SYNTHESIS ───────────────────────────────────────────────────────
// Claude receives locked score + signals + raw data.
// Produces the plain-English summary, expanded flags, and recommendation.

export async function scoreRisk(raw) {
  const { score, signals } = computeRiskSignals(raw);
  const { profile, officers, filing, charges, pscs } = raw;

  const riskLevel = score < 30 ? 'low' : score < 60 ? 'medium' : 'high';

  // Build a compact data summary to stay within context limits
  const dataSummary = {
    company: {
      name: profile?.company_name,
      number: profile?.company_number,
      status: profile?.company_status,
      type: profile?.type,
      created: profile?.date_of_creation,
      address: [
        profile?.registered_office_address?.address_line_1,
        profile?.registered_office_address?.locality,
        profile?.registered_office_address?.postal_code,
      ].filter(Boolean).join(', '),
      sic_codes: profile?.sic_codes,
      accounts_next_due: profile?.accounts?.next_due,
      accounts_last_made_up: profile?.accounts?.last_accounts?.made_up_to,
      accounts_type: profile?.accounts?.last_accounts?.type,
      cs_next_due: profile?.confirmation_statement?.next_due,
      cs_overdue: profile?.confirmation_statement?.overdue,
    },
    directors: {
      active: officers?.items
        ?.filter(o => o.officer_role === 'director' && !o.resigned_on)
        ?.map(o => ({ name: o.name, appointed: o.appointed_on })) || [],
      recent_resignations: officers?.items
        ?.filter(o => {
          if (!o.resigned_on || o.officer_role !== 'director') return false;
          return (Date.now() - new Date(o.resigned_on)) / 86400000 < 365;
        })
        ?.map(o => ({ name: o.name, resigned: o.resigned_on })) || [],
    },
    charges: {
      outstanding_count: charges?.items?.filter(c => c.status === 'outstanding')?.length || 0,
      satisfied_count: charges?.items?.filter(c => c.status === 'fully-satisfied')?.length || 0,
      sample: charges?.items?.slice(0, 3)?.map(c => ({
        status: c.status,
        created: c.created_on,
        description: c.particulars?.description?.slice(0, 100),
      })),
    },
    pscs: pscs?.items?.map(p => ({
      name: p.name,
      kind: p.kind,
      nature: p.natures_of_control,
      ceased: p.ceased_on,
    })) || [],
    recent_filings: filing?.items?.slice(0, 10)?.map(f => ({
      type: f.type,
      date: f.date,
      description: f.description?.slice(0, 80),
    })) || [],
  };

  const prompt = `You are a UK company risk analyst producing structured JSON risk profiles.

DETERMINISTIC RISK SCORE (do not change): ${score}/100
RISK LEVEL: ${riskLevel}
RISK SIGNALS (computed from Companies House data):
${JSON.stringify(signals, null, 2)}

COMPANIES HOUSE DATA SUMMARY:
${JSON.stringify(dataSummary, null, 2)}

Produce a risk profile. Return ONLY valid JSON — no markdown fences, no preamble, no trailing text.

Required shape:
{
  "company_number": "string",
  "company_name": "string — use official name from CH",
  "status": "string — company_status from CH",
  "incorporated": "YYYY-MM-DD",
  "sic_codes": ["string — include description if available"],
  "registered_address": "string — full formatted address",
  "risk_score": ${score},
  "risk_level": "${riskLevel}",
  "health_summary": "string — 2-4 sentences. Be specific: name actual dates, counts, and facts from the data. State the most important risk factors first. Do not hedge excessively or use filler phrases.",
  "flags": [
    { "type": "ok|warn|red", "icon": "✓|⚠|✗", "text": "concise flag — one specific fact" }
  ],
  "data": [
    { "label": "string", "value": "string" }
  ],
  "ownership": "string — 1-2 sentences from PSC data. Name the PSC if it is a company or well-known entity. If unclear, say so plainly.",
  "recommendation": "string — one direct actionable sentence. Name a specific action, not a generic suggestion."
}

Rules:
- risk_score must be exactly ${score} — do not change it
- risk_level must be "${riskLevel}"
- flags: include all signals from the list above, plus any others you identify in the data. Order: red flags first, then warn, then ok.
- health_summary: reference specific data — e.g. 'accounts overdue since [date]', '${dataSummary.directors.active.length} active directors', 'incorporated [X] years ago'
- data grid: 7-8 rows — Incorporated, Status, Type, Directors, PSC count, SIC, Last accounts, Charges outstanding
- recommendation: be direct. For high risk: name what NOT to do. For low risk: what standard process applies. Never say 'consider' or 'may wish to'.
- ownership: if it is a listed company, say so. If it is a single individual at 75%+, name them if available.`;

  try {
    const msg = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Enforce score — Claude must not override it
    parsed.risk_score = score;
    parsed.risk_level = riskLevel;

    return parsed;

  } catch (err) {
    console.error('Claude synthesis failed:', err.message);

    // Graceful fallback — return deterministic data without Claude summary
    return {
      company_number: profile?.company_number || 'unknown',
      company_name: profile?.company_name || 'Unknown',
      status: profile?.company_status || 'unknown',
      incorporated: profile?.date_of_creation || null,
      sic_codes: profile?.sic_codes || [],
      registered_address: dataSummary.company.address,
      risk_score: score,
      risk_level: riskLevel,
      health_summary: `Risk score ${score}/100 (${riskLevel}). ${signals.filter(s => s.type !== 'ok').map(s => s.text).join('. ')}.`,
      flags: signals,
      data: [
        { label: 'Incorporated', value: profile?.date_of_creation || '—' },
        { label: 'Status', value: profile?.company_status || '—' },
        { label: 'Directors', value: `${dataSummary.directors.active.length} active` },
        { label: 'PSC', value: `${dataSummary.pscs.length} on record` },
        { label: 'Charges', value: `${dataSummary.charges.outstanding_count} outstanding` },
      ],
      ownership: dataSummary.pscs.length > 0
        ? `${dataSummary.pscs.length} PSC(s) on record`
        : 'No PSC recorded',
      recommendation: score >= 60
        ? 'High risk — do not proceed without full legal and financial due diligence.'
        : score >= 30
        ? 'Moderate risk — request latest accounts and references before committing.'
        : 'Low risk — proceed with standard commercial terms.',
      _fallback: true,
    };
  }
}
