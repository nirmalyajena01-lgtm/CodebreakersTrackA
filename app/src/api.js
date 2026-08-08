// ============================================================================
// SwarmTriage DEMO — in-browser simulated backend.
//
// This module is a drop-in replacement for the real frontend's HTTP api.js:
// it exports the exact same async functions, but instead of calling the
// FastAPI backend it runs a faithful JavaScript port of the Python mock
// pipeline (backend/app/llm/mock.py + agents A→E + swarm memory) entirely in
// the browser, against an in-memory ticket store. No network, no API keys.
//
// Exported API (identical signatures to the real api.js):
//   submitTicket(rawText, customerEmail)
//   getQueue()  getTickets()  getTicket(ticketId)
//   approveTicket(ticketId, draftStyle, editedText?)
//   rejectTicket(ticketId, reason, freeText?)
//   getAudit(ticketId)  getHealth()
//   auth:    getCaptcha() signup(...) login(...) getMe() setAuthToken(token)
//   onboarding: createOnboardingPlan(...) listOnboardingPlans()
//               getOnboardingPlan(id) setOnboardingTaskStatus(...)
//               getOnboardingAudit(planId)
// ============================================================================

import { extractJson, geminiComplete } from './gemini.js';
import { zaiComplete } from './zai.js';

// ---------------------------------------------------------------------------
// Config (mirrors backend/app/config.py)
// ---------------------------------------------------------------------------

const COMPLIANCE_THRESHOLD = 80;
const RAG_TOP_K = 3;

const ROUTING_TABLE = {
  Billing: 'finance_manager@company.com',
  'Technical Bug': 'engineering_lead@company.com',
  'Feature Request': 'product_manager@company.com',
};
const ESCALATION_CC = 'vp_support@company.com';
const ESCALATION_SENTIMENT_THRESHOLD = 7.0;

const DRAFT_STYLES = ['formal', 'empathetic', 'concise'];

// ---------------------------------------------------------------------------
// Keyword tables + compliance patterns (ported from backend/app/llm/mock.py)
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS = {
  Billing: [
    'invoice', 'bill', 'billing', 'charged', 'charge', 'overcharged',
    'refund', 'payment', 'subscription', 'auto-renew', 'auto renew',
    'renewal', 'credit card', 'price', 'pricing', 'cost', 'double-charged',
    'receipt',
  ],
  'Technical Bug': [
    'bug', 'crash', 'crashes', 'crashed', 'error', 'broken', 'not working',
    "doesn't work", 'does not work', 'fails', 'failing', 'failed',
    'exception', '500', '404', 'blank screen', 'freeze', 'froze', 'glitch',
    'login', 'log in', "can't log", 'cannot log', 'timeout', 'slow',
  ],
  'Feature Request': [
    'feature', 'would be nice', 'could you add', 'please add', 'request',
    'wish', 'suggestion', 'integrate', 'integration', 'support for',
    'dark mode', 'export', 'api',
  ],
};

const STRONG_ANGER_WORDS = [
  'furious', 'outraged', 'unacceptable', 'ridiculous', 'scam', 'livid',
  'appalling', 'disgrace', 'worst', 'never again', 'lawyer', 'sue',
  'cancel my', 'demand', 'disgusting', 'theft', 'stealing', 'fraud',
];
const MILD_ANGER_WORDS = [
  'angry', 'terrible', 'horrible', 'awful', 'frustrated', 'frustrating',
  'sick of', 'fed up', 'incompetent', 'disappointed', 'annoying',
  'annoyed', 'upset', 'still not', 'again',
];
const HAPPY_WORDS = [
  'thanks', 'thank you', 'great', 'love', 'appreciate', 'happy', 'awesome',
  'excellent', 'pleased', 'amazing', 'fantastic', 'helpful',
];

const FAULT_PATTERN = /\b(our fault|we were wrong|we caused|our mistake|it is our fault|we are liable|we accept liability|we messed up)\b/i;
const SLA_PATTERN = /\b(within \d+ (hours?|days?|minutes?)|guaranteed?|by tomorrow|fixed immediately|asap)\b/i;
const REFUND_PROMISE_PATTERN = /\b(full refund|refund (has been|is being|will be) issued|we will refund|money back|refund you)\b/i;
const PII_PATTERN = /(\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\bpassword\b|\bssn\b|\bsecurity code\b|\bcvv\b)/i;
const AGGRESSIVE_PATTERN = /\b(calm down|your fault|not our problem|deal with it|stop complaining|you should have known|obviously)\b/i;
const JARGON_PATTERN = /\b(stack trace|nullpointer|segfault|traceback|http 5\d\d|core dump)\b/i;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary keyword matching (same as Python's re.search(r"\bkw\b")).
function hits(text, keywords) {
  const lowered = text.toLowerCase();
  return keywords.filter((kw) => new RegExp(`\\b${escapeRe(kw)}\\b`).test(lowered));
}

// Approximate Python str.isupper(): at least one cased char, all cased upper.
const isUpper = (text) => /[A-Z]/.test(text) && !/[a-z]/.test(text);

// Python repr() of a string, for reasoning strings that quote matched words.
const pyRepr = (s) =>
  s.includes("'") && !s.includes('"')
    ? `"${s}"`
    : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Python round(x, 1) — round half to even on one decimal.
function round1(x) {
  const y = x * 10;
  const f = Math.floor(y);
  const diff = y - f;
  let r;
  if (diff > 0.5) r = f + 1;
  else if (diff < 0.5) r = f;
  else r = f % 2 === 0 ? f : f + 1;
  return r / 10;
}

// Monotonic UTC clock: every timestamp is strictly increasing so timelines
// and ticket ordering are always chronological (ISO 8601 UTC, Python style).
let _clock = Date.now();
function utcNow() {
  _clock = Math.max(Date.now(), _clock + 1);
  return `${new Date(_clock).toISOString().replace('Z', '+00:00')}`;
}

// uuid4-style hex id (SPEC §2.1: "uuid4 hex").
function uuid4hex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Simulated network latency so the UI feels like it talks to a service.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Global state (mirrors backend/app/state.py)
// ---------------------------------------------------------------------------

const tickets = {}; // ticket_id -> TicketState
const auditLog = {}; // ticket_id -> [audit events]

function appendAudit(ticketId, agent, event, detail) {
  const entry = { timestamp: utcNow(), agent, event, detail };
  (auditLog[ticketId] = auditLog[ticketId] || []).push(entry);
  return entry;
}

function newTicketState(rawText, customerEmail) {
  return {
    ticket_id: uuid4hex(),
    raw_text: rawText,
    customer_email: customerEmail,
    ingestion_timestamp: utcNow(),
    validation: { valid: false, errors: [] },
    category: null,
    category_reasoning: null,
    sentiment: null,
    sentiment_score: null,
    sentiment_reasoning: null,
    assigned_approver: null,
    routing_reasoning: null,
    rag_feedback_used: [],
    drafts: [],
    rejection_feedback_log: [],
    human_approval_timestamp: null,
    approved_draft_style: null,
    final_status: 'processing',
  };
}

// ---------------------------------------------------------------------------
// Swarm memory (mirrors backend/app/memory/swarm_memory.py)
//
// Same contract as the backend: update stores the rejection reason, retrieve
// ranks same-category entries by cosine similarity over a deterministic
// hashing bag-of-words embedding (FNV-1a 32-bit here instead of md5 — same
// construction as the backend's pure-numpy HashingEmbedder fallback) and
// fills remaining slots with cross-category entries clearing a 0.1 threshold.
// ---------------------------------------------------------------------------

const _memoryEntries = [];

const _HASH_DIM = 256;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hashEmbed(text) {
  const vec = new Float64Array(_HASH_DIM);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const token of tokens) {
    const h = fnv1a(token);
    vec[h % _HASH_DIM] += (h >> 13) % 2 === 0 ? 1.0 : -1.0;
  }
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const h = fnv1a(`${tokens[i]}_${tokens[i + 1]}`);
    vec[h % _HASH_DIM] += 0.5;
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm > 0) for (let i = 0; i < _HASH_DIM; i += 1) vec[i] /= norm;
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < _HASH_DIM; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.max(Math.sqrt(na) * Math.sqrt(nb), 1e-9);
  return dot / denom;
}

function updateSwarmMemory(ticketId, category, reason, freeText) {
  _memoryEntries.push({
    ticket_id: ticketId,
    category: category || 'Unknown',
    reason,
    free_text: freeText || null,
    text: freeText ? `${reason}. ${freeText}`.trim() : reason,
    timestamp: utcNow(),
  });
}

function retrieveRelevantFeedback(category, queryText, topK = RAG_TOP_K) {
  const snapshot = [..._memoryEntries];
  if (!snapshot.length || topK <= 0) return [];
  const queryVec = hashEmbed(`${category}. ${queryText}`);
  const scored = snapshot.map((entry) => ({
    entry,
    sim: cosine(queryVec, hashEmbed(entry.text)),
  }));
  const same = scored
    .filter((s) => s.entry.category === category)
    .sort((a, b) => b.sim - a.sim);
  const cross = scored
    .filter((s) => s.entry.category !== category && s.sim > 0.1)
    .sort((a, b) => b.sim - a.sim);
  return same.concat(cross).slice(0, topK).map((s) => s.entry.text);
}

// ---------------------------------------------------------------------------
// Agent B — Classifier (ports MockLLM._classify / ._sentiment)
// ---------------------------------------------------------------------------

function mockClassify(text) {
  const cats = Object.keys(CATEGORY_KEYWORDS);
  const scores = {};
  for (const c of cats) scores[c] = hits(text, CATEGORY_KEYWORDS[c]).length;
  let best = cats[0];
  for (const c of cats) if (scores[c] > scores[best]) best = c; // ties → first
  if (scores[best] === 0) {
    return {
      category: 'Billing',
      category_reasoning:
        'No strong category keywords detected; defaulting to ' +
        'Billing because account/charge questions are the most ' +
        'common support intake.',
    };
  }
  const matched = hits(text, CATEGORY_KEYWORDS[best]).slice(0, 5);
  return {
    category: best,
    category_reasoning:
      `Matched ${scores[best]} keyword(s) for ${best} ` +
      `(${matched.map(pyRepr).join(', ')}); other categories scored lower ` +
      `(Billing=${scores.Billing}, ` +
      `Technical Bug=${scores['Technical Bug']}, ` +
      `Feature Request=${scores['Feature Request']}).`,
  };
}

function mockSentiment(text) {
  const strong = hits(text, STRONG_ANGER_WORDS);
  const mild = hits(text, MILD_ANGER_WORDS);
  const happy = hits(text, HAPPY_WORDS);
  const exclamations =
    (text.split('!').length - 1) + (isUpper(text) && text.length > 20 ? 1 : 0);

  let score;
  let reasoning;
  let sentiment;
  if (strong.length) {
    score = Math.min(10.0, 8.5 + 0.5 * (strong.length - 1) + 0.25 * Math.min(exclamations, 2));
    reasoning =
      `Strong anger signals detected (${strong.slice(0, 5).map(pyRepr).join(', ')})` +
      (exclamations ? ` plus ${exclamations} exclamation emphasis` : '') +
      '; scoring near the top of the urgency scale.';
    sentiment = 'Anger';
  } else if (mild.length) {
    score = Math.min(6.9, 4.5 + 0.6 * (mild.length - 1) + 0.3 * Math.min(exclamations, 2));
    reasoning =
      `Moderate frustration signals (${mild.slice(0, 5).map(pyRepr).join(', ')}); ` +
      'customer is unhappy but not explosive.';
    sentiment = score >= 7.0 ? 'Anger' : 'Neutral';
  } else if (happy.length) {
    score = Math.max(0.5, 2.0 - 0.3 * (happy.length - 1));
    reasoning =
      `Positive language detected (${happy.slice(0, 5).map(pyRepr).join(', ')}); ` +
      'customer appears satisfied.';
    sentiment = 'Happy';
  } else {
    score = 5.0;
    reasoning =
      'No strong emotional keywords detected; treating the ticket ' +
      'as a neutral, matter-of-fact request.';
    sentiment = 'Neutral';
  }
  return { sentiment, sentiment_score: round1(score), sentiment_reasoning: reasoning };
}

function runClassifier(ticket, llm) {
  const classification = (llm && llm.classification) || mockClassify(ticket.raw_text);
  ticket.category = classification.category;
  ticket.category_reasoning = classification.category_reasoning;
  appendAudit(
    ticket.ticket_id,
    'B',
    'classification',
    `Category=${ticket.category}. Reasoning: ${ticket.category_reasoning}`,
  );

  const sentiment = (llm && llm.sentimentData) || mockSentiment(ticket.raw_text);
  ticket.sentiment = sentiment.sentiment;
  ticket.sentiment_score = Math.max(0.0, Math.min(10.0, round1(sentiment.sentiment_score)));
  ticket.sentiment_reasoning = sentiment.sentiment_reasoning;
  appendAudit(
    ticket.ticket_id,
    'B',
    'sentiment_analysis',
    `Sentiment=${ticket.sentiment} score=${ticket.sentiment_score}/10. Reasoning: ${ticket.sentiment_reasoning}`,
  );
}

// ---------------------------------------------------------------------------
// Agent C — Router (ports agents/router.py)
// ---------------------------------------------------------------------------

function runRouter(ticket) {
  const category = ticket.category || 'Billing';
  const approver = ROUTING_TABLE[category] || ROUTING_TABLE.Billing;
  ticket.assigned_approver = approver;

  const score = Number(ticket.sentiment_score) || 0.0;
  let reasoning =
    `Category '${category}' routes to ${approver} per the routing table ` +
    `(${Object.entries(ROUTING_TABLE).map(([k, v]) => `${k}→${v}`).join('; ')}).`;
  if (score >= ESCALATION_SENTIMENT_THRESHOLD) {
    reasoning +=
      ` ESCALATION: sentiment_score ${score} ≥ ` +
      `${ESCALATION_SENTIMENT_THRESHOLD}, so ` +
      `${ESCALATION_CC} is CC'd on this ticket.`;
  }
  ticket.routing_reasoning = reasoning;
  appendAudit(ticket.ticket_id, 'C', 'routing', reasoning);
}

// ---------------------------------------------------------------------------
// Agent D — Drafter (ports MockLLM._draft + agents/drafter.py)
// ---------------------------------------------------------------------------

function draftSubject(category, sentimentScore) {
  const topic = {
    Billing: 'your billing inquiry',
    'Technical Bug': 'the technical issue you reported',
    'Feature Request': 'your feature suggestion',
  }[category] || 'your request';
  const prefix =
    sentimentScore >= 7
      ? 'Thank you for reaching out — we take your message seriously.'
      : 'Thank you for contacting us.';
  return `${prefix} This message concerns ${topic}.`;
}

function draftEmpathyLine(sentimentScore, soften) {
  let base;
  if (sentimentScore >= 7) {
    base =
      'We completely understand how frustrating this situation is, ' +
      'and we are sorry for the inconvenience it has caused you.';
  } else if (sentimentScore >= 4) {
    base = 'We understand this has been inconvenient, and we want to help.';
  } else {
    base = 'We appreciate you taking the time to write to us.';
  }
  if (soften) {
    base += ' Please know there is no pressure on your side — we are here to help at your pace.';
  }
  return base;
}

function draftBodyLine(category, verifyFacts) {
  if (verifyFacts) {
    return (
      'Our team is currently verifying the details of your account ' +
      'before confirming any specifics, so that we do not give you ' +
      'inaccurate information.'
    );
  }
  return {
    Billing:
      'Your billing concern has been logged and will be reviewed by ' +
      'our billing team, who will check the charges on your account.',
    'Technical Bug':
      'Our engineering team has been notified and is actively ' +
      'investigating the behavior you described.',
    'Feature Request':
      'Your suggestion has been shared with our product team, who ' +
      'review every request when planning upcoming releases.',
  }[category] || 'Our team is looking into your request.';
}

function draftNextStep(category, ticketId, sentimentScore, beSpecific) {
  let step;
  if (sentimentScore >= 7) {
    step =
      'Because of the impact this has had on you, your case has been ' +
      'escalated to a senior specialist who will personally oversee it.';
  } else {
    step = 'A specialist from the responsible team has been assigned to your case.';
  }
  if (beSpecific) {
    step +=
      ` Next step: the owning team reviews ticket ${ticketId} and ` +
      'replies to this email thread with an update; you do not need ' +
      'to take any action.';
  } else {
    step += ' You will receive an update on this email thread as soon as there is news.';
  }
  return step;
}

function simplifyText(text) {
  const replacements = [
    ['inconvenience', 'trouble'],
    ['approximately', 'about'],
    ['regarding', 'about'],
    ['investigating', 'checking'],
    ['additionally', 'also'],
    ['personally oversee', 'handle'],
  ];
  let out = text;
  for (const [longWord, simple] of replacements) {
    out = out.replace(new RegExp(escapeRe(longWord), 'gi'), simple);
  }
  return out;
}

function softenText(text) {
  const replacements = [
    ['you must', 'you may'],
    ['immediately', 'as soon as works for you'],
    ['as soon as possible', 'at a pace that suits you'],
  ];
  let out = text;
  for (const [hard, soft] of replacements) {
    out = out.replace(new RegExp(escapeRe(hard), 'gi'), soft);
  }
  return out;
}

function mockDraft(style, category, sentimentScore, ticketId, feedback) {
  const feedbackBlob = feedback.join(' ').toLowerCase();
  const soften = feedbackBlob.includes('too aggressive');
  const simplify = feedbackBlob.includes('too complex');
  const beSpecific = feedbackBlob.includes('too vague');
  const verifyFacts = feedbackBlob.includes('incorrect info');

  const thoughtBits = [
    `Drafting a ${style} reply for a ${category} ticket ` +
      `(sentiment_score=${sentimentScore}).`,
  ];
  if (feedback.length) {
    thoughtBits.push(
      'Applied feedback from prior human rejections retrieved via ' +
        `swarm memory: ${feedback.map((f) => `'${f}'`).join('; ')}.`,
    );
    if (soften) {
      thoughtBits.push(
        "Because a previous draft was rejected as 'Too aggressive', " +
          'this version deliberately softens the tone: extra empathy, ' +
          'no pressure language, no deadlines imposed on the customer.',
      );
    }
    if (simplify) {
      thoughtBits.push(
        "Because a previous draft was rejected as 'Too complex', " +
          'this version uses short plain-language sentences and avoids ' +
          'jargon and long paragraphs.',
      );
    }
    if (beSpecific) {
      thoughtBits.push(
        "Because a previous draft was rejected as 'Too vague', this " +
          'version states the concrete next step and owning team.',
      );
    }
    if (verifyFacts) {
      thoughtBits.push(
        "Because a previous draft was rejected as 'Incorrect info', " +
          'this version avoids unverified claims and says the team is ' +
          'verifying the account details.',
      );
    }
  } else {
    thoughtBits.push(
      'No prior rejection feedback found in swarm memory for this ' +
        'category; using the standard template.',
    );
  }

  const subjectLine = draftSubject(category, sentimentScore);
  const empathyLine = draftEmpathyLine(sentimentScore, soften);
  const bodyLine = draftBodyLine(category, verifyFacts);
  const nextStep = draftNextStep(category, ticketId, sentimentScore, beSpecific);

  let text;
  if (style === 'formal') {
    text =
      `Dear Customer,\n\n${subjectLine} ${empathyLine}\n\n` +
      `${bodyLine}\n\n${nextStep}\n\n` +
      `Kind regards,\nCustomer Support Team\nTicket reference: ${ticketId}`;
  } else if (style === 'empathetic') {
    text =
      `Hello,\n\n${empathyLine} ${subjectLine}\n\n` +
      `${bodyLine}\n\n${nextStep}\n\n` +
      'We truly appreciate your patience while we work on this for you.\n\n' +
      `Warm regards,\nCustomer Care\nTicket reference: ${ticketId}`;
  } else {
    text =
      `${subjectLine}\n` +
      `- ${bodyLine}\n` +
      `- ${nextStep}\n` +
      `Ticket reference: ${ticketId} — our team will follow up.`;
  }

  if (simplify) text = simplifyText(text);
  if (soften) text = softenText(text);

  thoughtBits.push(
    'Policy self-check: no refund guarantees, no fault admission, no ' +
      `SLA promises; ticket id ${ticketId} referenced for closure.`,
  );
  return { text: text.trim(), thought_process: thoughtBits.join(' ') };
}

function runDrafter(ticket, llm) {
  const category = ticket.category || 'Billing';
  const sentimentScore = Number(ticket.sentiment_score) || 5.0;

  // 1) RAG FIRST: retrieve relevant past rejection feedback.
  const feedback = retrieveRelevantFeedback(category, ticket.raw_text, RAG_TOP_K);
  ticket.rag_feedback_used = feedback;
  if (feedback.length) {
    appendAudit(
      ticket.ticket_id,
      'D',
      'rag_retrieval',
      'Retrieved prior rejection feedback from swarm memory to adapt ' +
        `drafts: ${feedback.map(pyRepr).join(' | ')}`,
    );
  } else {
    appendAudit(
      ticket.ticket_id,
      'D',
      'rag_retrieval',
      'No relevant prior rejection feedback in swarm memory; ' +
        'drafting from base templates.',
    );
  }

  // 2) Generate exactly 3 drafts (formal / empathetic / concise).
  ticket.drafts = DRAFT_STYLES.map((style) => {
    let result;
    if (llm && llm.drafts && llm.drafts[style]) {
      const gd = llm.drafts[style];
      let text = gd.text;
      // Match the mock drafts' contract: every draft references the ticket id.
      if (!text.includes(ticket.ticket_id)) {
        text += `\n\nTicket reference: ${ticket.ticket_id}`;
      }
      result = { text, thought_process: gd.thought_process };
    } else {
      result = mockDraft(style, category, sentimentScore, ticket.ticket_id, feedback);
    }
    return {
      style,
      text: result.text,
      thought_process: result.thought_process,
      compliance_score: null,
      compliance_reasoning: null,
      compliance_passed: null,
    };
  });

  const summary = ticket.drafts.map((d) => `[${d.style}] ${d.thought_process}`).join('; ');
  appendAudit(
    ticket.ticket_id,
    'D',
    'drafting',
    `Generated 3 drafts (formal/empathetic/concise) using ` +
      `${feedback.length} RAG feedback item(s). Thought processes: ${summary}`,
  );
}

// ---------------------------------------------------------------------------
// Agent E — Compliance (ports MockLLM._compliance + agents/compliance.py)
// ---------------------------------------------------------------------------

function mockCompliance(draft, ticketId, sentimentScore) {
  let score = 100;
  const violations = [];

  if (FAULT_PATTERN.test(draft)) {
    score -= 40;
    violations.push('admits fault/liability (policy rule 2)');
  }
  if (REFUND_PROMISE_PATTERN.test(draft)) {
    score -= 35;
    violations.push('promises a refund outcome (policy rule 1)');
  }
  if (SLA_PATTERN.test(draft)) {
    score -= 25;
    violations.push('promises a specific resolution time/SLA (policy rule 3)');
  }
  if (PII_PATTERN.test(draft)) {
    score -= 30;
    violations.push('contains or requests sensitive PII (policy rule 4)');
  }
  if (AGGRESSIVE_PATTERN.test(draft)) {
    score -= 30;
    violations.push('aggressive or dismissive tone (policy rule 6)');
  }
  if (JARGON_PATTERN.test(draft)) {
    score -= 10;
    violations.push('technical jargon a layperson cannot follow (policy rule 7)');
  }
  if (sentimentScore >= 7.0 && !draft.toLowerCase().includes('escalat')) {
    score -= 15;
    violations.push(
      'high-anger ticket but draft does not mention escalation (policy rule 5)',
    );
  }
  if (ticketId && !draft.includes(ticketId)) {
    score -= 10;
    violations.push('does not reference the ticket ID (policy rule 8)');
  }

  score = Math.max(0, score);
  const reasoning = violations.length
    ? `Score ${score}/100. Violations detected: ${violations.join('; ')}.`
    : `Score ${score}/100. Checked against all 8 policy rules: no ` +
      'refund guarantees, no fault admission, no SLA promises, no ' +
      'PII exposure, escalation acknowledged where required, ' +
      'respectful tone, plain language, and ticket ID referenced.';
  return { score, reasoning };
}

function runCompliance(ticket) {
  const sentimentScore = Number(ticket.sentiment_score) || 5.0;

  for (const draft of ticket.drafts || []) {
    const result = mockCompliance(draft.text, ticket.ticket_id, sentimentScore);
    const score = Math.max(0, Math.min(100, Math.round(result.score)));
    draft.compliance_score = score;
    draft.compliance_reasoning = result.reasoning;
    draft.compliance_passed = score >= COMPLIANCE_THRESHOLD;
  }

  const passed = (ticket.drafts || []).filter((d) => d.compliance_passed);
  let outcome;
  if (passed.length) {
    ticket.final_status = 'pending_review';
    outcome =
      `${passed.length}/${ticket.drafts.length} draft(s) passed ` +
      `(threshold ${COMPLIANCE_THRESHOLD}); status → pending_review.`;
  } else {
    ticket.final_status = 'escalated';
    outcome =
      'ALL drafts scored below the compliance threshold ' +
      `(${COMPLIANCE_THRESHOLD}); status → escalated for senior handling.`;
  }

  const detail = (ticket.drafts || [])
    .map(
      (d) =>
        `[${d.style}] score=${d.compliance_score} ` +
        `passed=${d.compliance_passed} — ${d.compliance_reasoning}`,
    )
    .join(' | ');
  appendAudit(
    ticket.ticket_id,
    'E',
    'compliance_check',
    `${outcome} Per-draft: ${detail}`,
  );
}

// ---------------------------------------------------------------------------
// Agent A — Orchestrator (ports agents/orchestrator.py)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function runOrchestrator(ticket) {
  const errors = [];
  const rawText = (ticket.raw_text || '').trim();
  const email = (ticket.customer_email || '').trim();

  if (!rawText) {
    errors.push('raw_text is empty');
  } else if (rawText.length < 10) {
    errors.push('raw_text is too short to triage (< 10 characters)');
  }
  if (!EMAIL_RE.test(email)) {
    errors.push(`customer_email ${pyRepr(email)} is not a valid email address`);
  }

  ticket.raw_text = rawText;
  ticket.customer_email = email;
  ticket.validation = { valid: errors.length === 0, errors };

  const detail = errors.length
    ? `Validation FAILED: ${errors.join('; ')}`
    : `Intake validated: ${rawText.length} chars from ${email}. ` +
      'TicketState initialized; handing off to Classifier (Agent B).';
  appendAudit(ticket.ticket_id, 'A', 'intake_validation', detail);
}

// ---------------------------------------------------------------------------
// Pipeline (ports agents/pipeline.py)
// ---------------------------------------------------------------------------

function runPipeline(ticketId, llm) {
  const ticket = tickets[ticketId];
  appendAudit(
    ticketId,
    'system',
    'pipeline_start',
    `Pipeline A→E started for ticket ${ticketId}.`,
  );
  try {
    runOrchestrator(ticket); // A: validate + initialize
    runClassifier(ticket, llm); // B: category + sentiment
    runRouter(ticket); //       C: route to approver
    runDrafter(ticket, llm); //  D: RAG retrieval + 3 drafts
    runCompliance(ticket); //   E: policy scoring, threshold 80
  } catch (exc) {
    ticket.final_status = 'escalated';
    appendAudit(
      ticketId,
      'system',
      'pipeline_error',
      `Pipeline error (${String(exc)}); ticket escalated for manual handling.`,
    );
  }
  appendAudit(
    ticketId,
    'system',
    'pipeline_complete',
    `Pipeline finished with final_status=${ticket.final_status}.`,
  );
  return ticket;
}

function rerunDrafterAndCompliance(ticketId) {
  const ticket = tickets[ticketId];
  runDrafter(ticket);
  runCompliance(ticket);
  return ticket;
}

// ---------------------------------------------------------------------------
// Seed data (mirrors backend/SEED_DATA.py: 5 tickets, 1 approval, 2 rejections
// with feedback, then the RAG-demo angry billing ticket)
// ---------------------------------------------------------------------------

const SEED_TICKETS = [
  {
    raw_text:
      'I am absolutely FURIOUS! You charged my credit card TWICE for the ' +
      'same invoice this month and this is the second time it has happened. ' +
      'This double-charged billing scam is completely unacceptable — refund ' +
      'my payment NOW or I am cancelling my subscription and calling my lawyer!',
    customer_email: 'karen.angry@example.com',
  },
  {
    raw_text:
      'Your app crashes every single time I try to log in. I get a 500 error ' +
      'and a blank screen, then it freezes. This bug is ridiculous and I am ' +
      'fed up — our whole team cannot work. Fix this broken login immediately!',
    customer_email: 'devon.frustrated@example.com',
  },
  {
    raw_text:
      'Hello, I noticed a charge on my latest invoice that I do not recognize. ' +
      'Could the billing team please review it when convenient? Thanks.',
    customer_email: 'morgan.neutral@example.com',
  },
  {
    raw_text:
      'Love the product so far! It would be nice if you could add a dark mode ' +
      'feature and an export-to-CSV option. Just a suggestion — keep up the ' +
      'great work, thanks!',
    customer_email: 'riley.happy@example.com',
  },
  {
    raw_text:
      'The export feature fails with an error whenever I select more than ' +
      '1000 rows. It just times out and nothing downloads. Can someone look ' +
      'into this issue? It is a bit annoying but not urgent.',
    customer_email: 'sam.patient@example.com',
  },
];

const RAG_DEMO_TICKET = {
  raw_text:
    'I am FURIOUS about my invoice! You overcharged my credit card again on ' +
    "this month's subscription payment and nobody from billing has answered. " +
    'This is the worst, completely unacceptable — I demand a refund and I will ' +
    'cancel my account if this charge is not fixed!',
  customer_email: 'taylor.irate@example.com',
};

function submitInternal(rawText, customerEmail, llm) {
  const ticket = newTicketState(rawText, customerEmail);
  tickets[ticket.ticket_id] = ticket;
  return runPipeline(ticket.ticket_id, llm);
}

function approveInternal(ticketId, draftStyle, editedText) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error(`Ticket ${pyRepr(ticketId)} not found`);
  const draft = (ticket.drafts || []).find((d) => d.style === draftStyle);
  if (!draft) {
    throw new Error(`Ticket has no draft with style ${pyRepr(draftStyle)}`);
  }
  let editNote = '';
  if (editedText != null && editedText !== '') {
    draft.text = editedText;
    editNote = ` Human edited the ${draftStyle} draft before approval.`;
  }
  ticket.human_approval_timestamp = utcNow();
  ticket.approved_draft_style = draftStyle;
  ticket.final_status = 'approved';
  appendAudit(
    ticketId,
    'human',
    'approval',
    `Human approved the '${draftStyle}' draft at ` +
      `${ticket.human_approval_timestamp}.${editNote}`,
  );
  return ticket;
}

function rejectInternal(ticketId, reason, freeText) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error(`Ticket ${pyRepr(ticketId)} not found`);

  ticket.rejection_feedback_log.push({
    timestamp: utcNow(),
    reason,
    free_text: freeText || null,
  });
  appendAudit(
    ticketId,
    'human',
    'rejection',
    `Human rejected the drafts. Reason: ${pyRepr(reason)}` +
      (freeText ? ` — details: ${freeText}` : ''),
  );

  // Store feedback in swarm memory, then re-run Drafter + Compliance.
  updateSwarmMemory(ticketId, ticket.category || 'Unknown', reason, freeText || null);
  appendAudit(
    ticketId,
    'system',
    'swarm_memory_update',
    'Rejection feedback embedded into swarm memory ' +
      `(category=${ticket.category}); re-running Drafter (D) and ` +
      'Compliance (E) with RAG feedback.',
  );
  return rerunDrafterAndCompliance(ticketId);
}

function seedStore() {
  const submitted = SEED_TICKETS.map((t) => submitInternal(t.raw_text, t.customer_email));
  const [furiousBilling, crashBug, neutralBilling] = submitted;

  // Approve 1 ticket (the neutral billing inquiry, formal draft).
  approveInternal(neutralBilling.ticket_id, 'formal');

  // Reject 2 tickets with distinct reasons.
  rejectInternal(
    furiousBilling.ticket_id,
    'Too aggressive',
    'The tone is too cold and demanding for an angry customer. ' +
      'Add more empathy and stop pressuring them.',
  );
  rejectInternal(
    crashBug.ticket_id,
    'Too complex',
    'The customer is not technical. Use short, plain sentences and ' +
      'drop the jargon.',
  );

  // Re-submit a similar angry billing ticket so the RAG tone change shows.
  submitInternal(RAG_DEMO_TICKET.raw_text, RAG_DEMO_TICKET.customer_email);
}

// Populate the store on first load so the dashboard is alive immediately.
seedStore();

// ---------------------------------------------------------------------------
// Exported API — identical async interface to the real frontend/src/api.js
// ---------------------------------------------------------------------------

export async function submitTicket(rawText, customerEmail) {
  await sleep(300); // the pipeline "runs" synchronously, like the backend
  if (rawText == null || String(rawText).length < 1) {
    throw new Error('raw_text: String should have at least 1 character');
  }
  if (!EMAIL_RE.test(String(customerEmail || ''))) {
    throw new Error('customer_email: String should match the email pattern');
  }
  // Try live LLMs for classification + sentiment + drafts first; ANY failure
  // (network/HTTP/parse/timeout) silently falls through to the next provider
  // and finally to the mock pipeline so the demo always works
  // (SPEC_AUTH_ONBOARDING §2). Provider chain: Gemini → z-ai GLM → mock.
  let llm = null;
  try {
    const raw = await geminiComplete(GEMINI_SYSTEM, geminiTicketPrompt(String(rawText)));
    llm = sanitizeGeminiResult(raw);
  } catch {
    llm = null;
  }
  if (!llm) {
    try {
      const raw = await zaiComplete(
        GEMINI_SYSTEM,
        geminiTicketPrompt(String(rawText)),
        extractJson,
      );
      llm = sanitizeGeminiResult(raw);
    } catch {
      llm = null;
    }
  }
  await sleep(300); // the pipeline "runs" synchronously, like the backend
  return submitInternal(String(rawText), String(customerEmail), llm);
}

export async function getQueue() {
  await sleep(120);
  const queue = Object.values(tickets)
    .filter((t) => ['pending_review', 'escalated'].includes(t.final_status))
    .sort((a, b) => (b.sentiment_score || 0.0) - (a.sentiment_score || 0.0));
  return { tickets: queue };
}

export async function getTickets() {
  await sleep(120);
  const all = Object.values(tickets).sort((a, b) =>
    (b.ingestion_timestamp || '').localeCompare(a.ingestion_timestamp || ''),
  );
  return { tickets: all };
}

export async function getTicket(ticketId) {
  await sleep(80);
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error(`Ticket ${pyRepr(ticketId)} not found`);
  return ticket;
}

export async function approveTicket(ticketId, draftStyle, editedText) {
  await sleep(200);
  return approveInternal(ticketId, draftStyle, editedText);
}

export async function rejectTicket(ticketId, reason, freeText) {
  await sleep(300); // feedback is stored + drafts regenerated, like the backend
  return rejectInternal(ticketId, reason, freeText);
}

export async function getAudit(ticketId) {
  await sleep(100);
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error(`Ticket ${pyRepr(ticketId)} not found`);
  const drafts = ticket.drafts || [];
  return {
    ticket_id: ticket.ticket_id,
    ingestion_timestamp: ticket.ingestion_timestamp,
    agent_a_classification_reasoning: (
      `Validation: ${ticket.validation.valid ? 'passed' : 'FAILED'} ` +
      `(errors: ${ticket.validation.errors.length ? ticket.validation.errors.join('; ') : 'none'}). ` +
      `Category: ${ticket.category}. ` +
      `${ticket.category_reasoning || ''} ` +
      `Routing: ${ticket.routing_reasoning || ''}`
    ).trim(),
    agent_b_sentiment_score_and_reasoning: {
      score: ticket.sentiment_score,
      reasoning: ticket.sentiment_reasoning,
    },
    agent_c_draft_variations_thought_process: drafts.map((d) => ({
      style: d.style,
      thought_process: d.thought_process,
    })),
    agent_d_compliance_check_score: drafts.map((d) => ({
      style: d.style,
      score: d.compliance_score,
      passed: d.compliance_passed,
      reasoning: d.compliance_reasoning,
    })),
    human_approval_timestamp: ticket.human_approval_timestamp,
    rejection_feedback_log: ticket.rejection_feedback_log || [],
    final_status: ticket.final_status,
    timeline: auditLog[ticketId] || [],
  };
}

export async function getHealth() {
  await sleep(50);
  return { status: 'ok', llm_provider: 'mock (in-browser demo)' };
}

// ---------------------------------------------------------------------------
// Gemini-backed ticket analysis (SPEC_AUTH_ONBOARDING §2)
//
// sanitizeGeminiResult() strictly validates the model output; anything
// unexpected returns null so the caller silently falls back to the mock
// pipeline. No UI surface ever mentions the provider or model.
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ['Billing', 'Technical Bug', 'Feature Request'];
const VALID_SENTIMENTS = ['Anger', 'Neutral', 'Happy'];

const GEMINI_SYSTEM =
  'You are the triage brain of an enterprise support automation system. ' +
  'You always reply with a single strict JSON object and nothing else — ' +
  'no markdown fences, no commentary.';

function geminiTicketPrompt(rawText) {
  return (
    'Analyze this customer support ticket and draft three reply variations.\n\n' +
    `TICKET:\n${rawText}\n\n` +
    'Reply with strict JSON in exactly this shape:\n' +
    '{\n' +
    '  "category": "Billing" | "Technical Bug" | "Feature Request",\n' +
    '  "category_reasoning": "one or two sentences",\n' +
    '  "sentiment": "Anger" | "Neutral" | "Happy",\n' +
    '  "sentiment_score": <number 0.0-10.0, higher = angrier/more urgent>,\n' +
    '  "sentiment_reasoning": "one or two sentences",\n' +
    '  "drafts": [\n' +
    '    {"style": "formal", "text": "...", "thought_process": "..."},\n' +
    '    {"style": "empathetic", "text": "...", "thought_process": "..."},\n' +
    '    {"style": "concise", "text": "...", "thought_process": "..."}\n' +
    '  ]\n' +
    '}\n' +
    'Draft rules: professional and warm; never admit fault or liability; ' +
    'never promise a refund outcome; never promise a specific resolution ' +
    'time; no jargon; if the customer is very angry, mention that the case ' +
    'is being escalated to a senior specialist.'
  );
}

function sanitizeGeminiResult(result) {
  if (!result || typeof result !== 'object') return null;
  const out = {};

  if (VALID_CATEGORIES.includes(result.category)) {
    out.classification = {
      category: result.category,
      category_reasoning:
        String(result.category_reasoning || '').trim() ||
        'Category inferred from the language and intent of the ticket.',
    };
  }

  const score = Number(result.sentiment_score);
  if (Number.isFinite(score)) {
    const clamped = Math.max(0.0, Math.min(10.0, round1(score)));
    out.sentimentData = {
      sentiment: VALID_SENTIMENTS.includes(result.sentiment)
        ? result.sentiment
        : clamped >= 7.0
          ? 'Anger'
          : clamped >= 4.0
            ? 'Neutral'
            : 'Happy',
      sentiment_score: clamped,
      sentiment_reasoning:
        String(result.sentiment_reasoning || '').trim() ||
        'Urgency inferred from the tone of the ticket.',
    };
  }

  if (Array.isArray(result.drafts)) {
    const byStyle = {};
    for (const d of result.drafts) {
      if (d && DRAFT_STYLES.includes(d.style) && typeof d.text === 'string' && d.text.trim()) {
        byStyle[d.style] = {
          text: d.text.trim(),
          thought_process:
            String(d.thought_process || '').trim() ||
            `Drafted a ${d.style} reply covering acknowledgement, action and next step.`,
        };
      }
    }
    if (DRAFT_STYLES.every((s) => byStyle[s])) out.drafts = byStyle;
  }

  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Auth (SPEC_AUTH_ONBOARDING §1) — in-browser users with SHA-256-hashed
// passwords, uuid4-hex tokens, persisted snapshot in localStorage.
// Captchas are generated client-side (canvas in the UI), single-use,
// 10-minute validity, case-insensitive comparison.
// ---------------------------------------------------------------------------

const AUTH_STORAGE_KEY = 'swarmtriage_demo_auth';
const CAPTCHA_TTL_MS = 10 * 60 * 1000;
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const authState = { users: [], tokens: {}, captchas: {} };
let currentToken = null;

function saveAuth() {
  try {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ users: authState.users, tokens: authState.tokens }),
    );
  } catch {
    // storage unavailable — session just won't survive reloads
  }
}

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.users)) authState.users = data.users;
    if (data.tokens && typeof data.tokens === 'object') authState.tokens = data.tokens;
  } catch {
    // corrupt snapshot — start fresh
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Seed the trial employee account on first boot (SPEC_AUTH_ONBOARDING §1).
const authReady = (async () => {
  loadAuth();
  if (!authState.users.some((u) => u.email === 'codebreaker@test.com')) {
    authState.users.push({
      user_id: uuid4hex(),
      name: 'Code Breaker',
      email: 'codebreaker@test.com',
      role: 'employee',
      password_hash: await sha256Hex('codebreaker'),
    });
    saveAuth();
  }
})();

function publicUser(user) {
  return {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function issueToken(user) {
  const token = uuid4hex();
  authState.tokens[token] = user.user_id;
  saveAuth();
  return token;
}

function verifyCaptcha(captchaId, captchaText) {
  const entry = authState.captchas[captchaId];
  if (!entry) {
    const err = new Error('Captcha expired — please refresh and try again.');
    err.status = 400;
    throw err;
  }
  delete authState.captchas[captchaId]; // single-use
  if (Date.now() > entry.expires) {
    const err = new Error('Captcha expired — please refresh and try again.');
    err.status = 400;
    throw err;
  }
  if (String(captchaText || '').trim().toUpperCase() !== entry.code.toUpperCase()) {
    const err = new Error('Captcha text does not match — please try again.');
    err.status = 400;
    throw err;
  }
}

export function setAuthToken(token) {
  currentToken = token || null;
}

// Returns {captcha_id, code} — the UI draws the code onto a canvas.
export async function getCaptcha() {
  await sleep(80);
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  }
  const captchaId = uuid4hex();
  authState.captchas[captchaId] = { code, expires: Date.now() + CAPTCHA_TTL_MS };
  return { captcha_id: captchaId, code };
}

export async function signup(name, email, password, captchaId, captchaText) {
  await authReady;
  await sleep(150);
  verifyCaptcha(captchaId, captchaText);
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (cleanName.length < 2) throw new Error('Please enter your full name.');
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('Please enter a valid email address.');
  if (cleanPassword.length < 6) throw new Error('Password must be at least 6 characters.');
  if (authState.users.some((u) => u.email === cleanEmail)) {
    throw new Error('An account with this email already exists — log in instead.');
  }
  const user = {
    user_id: uuid4hex(),
    name: cleanName,
    email: cleanEmail,
    role: 'customer', // signup is always the customer role
    password_hash: await sha256Hex(cleanPassword),
  };
  authState.users.push(user);
  const token = issueToken(user);
  return { token, user: publicUser(user) };
}

export async function login(email, password, captchaId, captchaText) {
  await authReady;
  await sleep(150);
  verifyCaptcha(captchaId, captchaText);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const hash = await sha256Hex(String(password || ''));
  const user = authState.users.find(
    (u) => u.email === cleanEmail && u.password_hash === hash,
  );
  if (!user) {
    const err = new Error('Invalid email or password.');
    err.status = 401;
    throw err;
  }
  const token = issueToken(user);
  return { token, user: publicUser(user) };
}

export async function getMe() {
  await authReady;
  await sleep(50);
  const userId = authState.tokens[currentToken];
  const user = authState.users.find((u) => u.user_id === userId);
  if (!user) {
    const err = new Error('Session expired — please log in again.');
    err.status = 401;
    throw err;
  }
  return { user: publicUser(user) };
}

// ---------------------------------------------------------------------------
// Onboarding coordinator (SPEC_AUTH_ONBOARDING §3) — agent-style plan
// generation from role templates, completion tracking, escalation on
// blocked/overdue tasks, and a per-plan audit timeline.
// ---------------------------------------------------------------------------

const HR_MANAGER = 'hr_manager@company.com';

export const ONBOARDING_ROLES = [
  'Support Agent',
  'Engineer',
  'Finance Analyst',
  'People Ops',
  'Sales Rep',
];

const ROLE_TEMPLATES = {
  'Support Agent': [
    { title: 'Create accounts & access (email, helpdesk, CRM)', owner: 'IT', offset_days: 0 },
    { title: 'Provision VPN and laptop hardware', owner: 'IT', offset_days: 0 },
    { title: 'Company policy & compliance training', owner: 'People Ops', offset_days: 1 },
    { title: 'Support tooling walkthrough (queue, macros, SLAs)', owner: 'Support Lead', offset_days: 2 },
    { title: 'Shadow five live ticket sessions', owner: 'Support Lead', offset_days: 3 },
    { title: 'Draft first three supervised customer replies', owner: 'Support Lead', offset_days: 5 },
    { title: 'Handle first solo ticket with review', owner: 'Support Lead', offset_days: 7 },
    { title: 'Product deep-dive with the product team', owner: 'Product Manager', offset_days: 10 },
    { title: 'Define 30-60-90 day goals with manager', owner: 'Hiring Manager', offset_days: 14 },
  ],
  Engineer: [
    { title: 'Create accounts & access (GitHub, CI, cloud console)', owner: 'IT', offset_days: 0 },
    { title: 'Provision laptop and dev environment', owner: 'IT', offset_days: 0 },
    { title: 'Security & compliance onboarding', owner: 'Security Team', offset_days: 1 },
    { title: 'Architecture overview walkthrough', owner: 'Engineering Lead', offset_days: 2 },
    { title: 'Set up local build and run the test suite', owner: 'Buddy Engineer', offset_days: 3 },
    { title: 'Pick up a starter bug and open first PR', owner: 'Engineering Lead', offset_days: 5 },
    { title: 'Shadow an on-call shift', owner: 'Buddy Engineer', offset_days: 7 },
    { title: 'Ship first reviewed change to production', owner: 'Engineering Lead', offset_days: 10 },
    { title: 'Define 30-60-90 day goals with manager', owner: 'Hiring Manager', offset_days: 14 },
  ],
  'Finance Analyst': [
    { title: 'Create accounts & access (ERP, expense, banking portals)', owner: 'IT', offset_days: 0 },
    { title: 'Provision VPN and hardware', owner: 'IT', offset_days: 0 },
    { title: 'Finance policy & controls training', owner: 'Finance Manager', offset_days: 1 },
    { title: 'Chart of accounts and reporting walkthrough', owner: 'Finance Manager', offset_days: 2 },
    { title: 'Shadow month-end close process', owner: 'Senior Analyst', offset_days: 5 },
    { title: 'Reconcile first expense batch with review', owner: 'Senior Analyst', offset_days: 7 },
    { title: 'Prepare first variance report draft', owner: 'Finance Manager', offset_days: 10 },
    { title: 'Define 30-60-90 day goals with manager', owner: 'Hiring Manager', offset_days: 14 },
  ],
  'People Ops': [
    { title: 'Create accounts & access (HRIS, ATS, payroll)', owner: 'IT', offset_days: 0 },
    { title: 'Provision VPN and hardware', owner: 'IT', offset_days: 0 },
    { title: 'HR compliance & confidentiality training', owner: 'HR Manager', offset_days: 1 },
    { title: 'HRIS and benefits platform walkthrough', owner: 'HR Manager', offset_days: 2 },
    { title: 'Shadow two onboarding sessions', owner: 'People Partner', offset_days: 4 },
    { title: 'Run first employee onboarding end-to-end', owner: 'People Partner', offset_days: 7 },
    { title: 'Review and update one HR process document', owner: 'HR Manager', offset_days: 10 },
    { title: 'Define 30-60-90 day goals with manager', owner: 'Hiring Manager', offset_days: 14 },
  ],
  'Sales Rep': [
    { title: 'Create accounts & access (CRM, email, dialer)', owner: 'IT', offset_days: 0 },
    { title: 'Provision VPN and hardware', owner: 'IT', offset_days: 0 },
    { title: 'Sales playbook & pricing training', owner: 'Sales Manager', offset_days: 1 },
    { title: 'CRM pipeline walkthrough and hygiene rules', owner: 'Sales Manager', offset_days: 2 },
    { title: 'Shadow five discovery and demo calls', owner: 'Senior Sales Rep', offset_days: 4 },
    { title: 'Deliver practice pitch for certification', owner: 'Sales Manager', offset_days: 6 },
    { title: 'Make first ten outbound calls with coaching', owner: 'Senior Sales Rep', offset_days: 8 },
    { title: 'Own first inbound lead end-to-end', owner: 'Sales Manager', offset_days: 12 },
    { title: 'Define 30-60-90 day quota ramp with manager', owner: 'Hiring Manager', offset_days: 14 },
  ],
};

const plans = {}; // plan_id -> Plan
const planAudit = {}; // plan_id -> [timeline events]

function planAppendAudit(planId, agent, event, detail) {
  const entry = { timestamp: utcNow(), agent, event, detail };
  (planAudit[planId] = planAudit[planId] || []).push(entry);
  return entry;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function generateTasks(role) {
  const template = ROLE_TEMPLATES[role] || ROLE_TEMPLATES['Support Agent'];
  return template.map((t) => ({
    task_id: uuid4hex(),
    title: t.title,
    owner: t.owner,
    offset_days: t.offset_days,
    status: 'pending',
    blocker_reason: null,
    completed_at: null,
  }));
}

function createPlanInternal(hireName, role, startDate, notes) {
  const tasks = generateTasks(role);
  const plan = {
    plan_id: uuid4hex(),
    hire_name: hireName,
    role,
    start_date: startDate,
    notes: notes || null,
    created_at: utcNow(),
    status: 'active',
    tasks,
    escalations: [],
    generation_reasoning:
      `Coordinator generated ${tasks.length} tasks from the ${role} template: ` +
      'accounts/access provisioning on day 0, policy training, tooling ' +
      'walkthrough, shadowing, a first supervised assignment, and 30-60-90 ' +
      `day goals, sequenced across the first ${tasks[tasks.length - 1].offset_days} days ` +
      'so dependencies (access before tooling, training before solo work) resolve in order.',
  };
  plans[plan.plan_id] = plan;
  planAppendAudit(
    plan.plan_id,
    'coordinator',
    'plan_created',
    `Onboarding plan created for ${hireName} (${role}, starts ${startDate}). ` +
      plan.generation_reasoning,
  );
  return plan;
}

// Escalation sweep (SPEC §3.3b): on plan read, tasks past
// start_date+offset_days and not done get an auto-escalation entry,
// once per task, with reason "overdue".
function overdueSweep(plan) {
  const today = todayStr();
  for (const task of plan.tasks) {
    // blocked tasks already carry an open escalation — don't double-escalate
    if (task.status === 'done' || task.status === 'blocked') continue;
    const due = addDays(plan.start_date, task.offset_days);
    if (today > due) {
      const already = plan.escalations.some(
        (e) => e.task_id === task.task_id && e.reason === 'overdue',
      );
      if (!already) {
        const entry = {
          timestamp: utcNow(),
          task_id: task.task_id,
          task_title: task.title,
          reason: 'overdue',
          escalated_to: HR_MANAGER,
        };
        plan.escalations.push(entry);
        planAppendAudit(
          plan.plan_id,
          'system',
          'escalation',
          `Task '${task.title}' is past due (${due}) and not done; ` +
            `auto-escalated to ${HR_MANAGER} (reason: overdue).`,
        );
      }
    }
  }
}

function refreshPlanStatus(plan) {
  const was = plan.status;
  plan.status = plan.tasks.every((t) => t.status === 'done') ? 'completed' : 'active';
  if (plan.status === 'completed' && was !== 'completed') {
    planAppendAudit(
      plan.plan_id,
      'coordinator',
      'plan_completed',
      `All ${plan.tasks.length} tasks done — onboarding plan for ${plan.hire_name} marked completed.`,
    );
  }
  return plan;
}

function findTask(taskId) {
  for (const plan of Object.values(plans)) {
    const task = plan.tasks.find((t) => t.task_id === taskId);
    if (task) return { plan, task };
  }
  return null;
}

// Seed: Ava Chen, Support Agent — 2 tasks done, 1 blocked
// ("VPN access not provisioned") which triggers an escalation (SPEC §5).
function seedOnboarding() {
  const plan = createPlanInternal('Ava Chen', 'Support Agent', addDays(todayStr(), -6), null);
  // Mark the first two tasks done.
  for (const task of plan.tasks.slice(0, 2)) {
    task.status = 'done';
    task.completed_at = utcNow();
    planAppendAudit(
      plan.plan_id,
      'coordinator',
      'task_completed',
      `Task '${task.title}' (${task.owner}) marked done.`,
    );
  }
  // Third task blocked — VPN not provisioned → immediate escalation.
  const blocked = plan.tasks[2];
  blocked.status = 'blocked';
  blocked.blocker_reason = 'VPN access not provisioned';
  const entry = {
    timestamp: utcNow(),
    task_id: blocked.task_id,
    task_title: blocked.title,
    reason: blocked.blocker_reason,
    escalated_to: HR_MANAGER,
  };
  plan.escalations.push(entry);
  planAppendAudit(
    plan.plan_id,
    'coordinator',
    'escalation',
    `Task '${blocked.title}' marked blocked: '${blocked.blocker_reason}'. ` +
      `Escalated to ${HR_MANAGER} for immediate resolution.`,
  );
  refreshPlanStatus(plan);
  return plan;
}

seedOnboarding();

export async function createOnboardingPlan(hireName, role, startDate, notes) {
  await sleep(200);
  const cleanName = String(hireName || '').trim();
  if (cleanName.length < 2) throw new Error('Please enter the new hire\u2019s name.');
  if (!ONBOARDING_ROLES.includes(role)) throw new Error(`Unknown role ${pyRepr(role)}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) {
    throw new Error('Start date must be YYYY-MM-DD.');
  }
  return createPlanInternal(cleanName, role, String(startDate), notes ? String(notes) : null);
}

export async function listOnboardingPlans() {
  await sleep(120);
  const all = Object.values(plans);
  for (const plan of all) overdueSweep(plan);
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // newest first
  return { plans: all };
}

export async function getOnboardingPlan(planId) {
  await sleep(80);
  const plan = plans[planId];
  if (!plan) throw new Error(`Plan ${pyRepr(planId)} not found`);
  overdueSweep(plan);
  return plan;
}

export async function setOnboardingTaskStatus(taskId, status, blockerReason) {
  await sleep(150);
  const found = findTask(taskId);
  if (!found) throw new Error(`Task ${pyRepr(taskId)} not found`);
  const { plan, task } = found;
  const valid = ['pending', 'in_progress', 'done', 'blocked'];
  if (!valid.includes(status)) throw new Error(`Invalid status ${pyRepr(status)}.`);

  if (status === 'blocked') {
    const reason = String(blockerReason || '').trim();
    if (!reason) throw new Error('A blocker reason is required to mark a task blocked.');
    task.status = 'blocked';
    task.blocker_reason = reason;
    task.completed_at = null;
    const entry = {
      timestamp: utcNow(),
      task_id: task.task_id,
      task_title: task.title,
      reason,
      escalated_to: HR_MANAGER,
    };
    plan.escalations.push(entry);
    planAppendAudit(
      plan.plan_id,
      'coordinator',
      'escalation',
      `Task '${task.title}' marked blocked: '${reason}'. Escalated to ${HR_MANAGER}.`,
    );
  } else {
    const prev = task.status;
    task.status = status;
    task.blocker_reason = null;
    task.completed_at = status === 'done' ? utcNow() : null;
    planAppendAudit(
      plan.plan_id,
      'coordinator',
      status === 'done' ? 'task_completed' : 'task_status',
      status === 'done'
        ? `Task '${task.title}' (${task.owner}) marked done.`
        : `Task '${task.title}' status ${prev} → ${status}.`,
    );
  }
  refreshPlanStatus(plan);
  return plan;
}

export async function getOnboardingAudit(planId) {
  await sleep(80);
  const plan = plans[planId];
  if (!plan) throw new Error(`Plan ${pyRepr(planId)} not found`);
  overdueSweep(plan);
  return {
    plan_id: plan.plan_id,
    timeline: planAudit[planId] || [],
    escalations: plan.escalations,
    status: plan.status,
  };
}
