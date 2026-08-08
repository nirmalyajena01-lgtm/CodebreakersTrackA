// API client for the SwarmTriage backend.
// Default: same-origin /api — the Vite dev-server proxy (see vite.config.js,
// target = VITE_BACKEND_URL) forwards it to the backend, so the browser never
// needs to resolve the backend hostname itself.
// Advanced escape hatch: set VITE_API_URL at build/dev time to call a backend
// base URL directly from the browser (must be browser-resolvable).

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Bearer token for the authenticated session (SPEC_AUTH_ONBOARDING §1).
// Restored from localStorage on load so a refresh keeps the session.
let authToken = null;
try {
  const saved = JSON.parse(localStorage.getItem('swarmtriage_session') || 'null');
  if (saved && saved.token) authToken = saved.token;
} catch {
  // no stored session
}

export function setAuthToken(token) {
  authToken = token || null;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      // keep default detail
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function submitTicket(rawText, customerEmail) {
  return request('/api/submit', {
    method: 'POST',
    body: JSON.stringify({ raw_text: rawText, customer_email: customerEmail }),
  });
}

export function getQueue() {
  return request('/api/queue');
}

export function getTickets() {
  return request('/api/tickets');
}

export function getTicket(ticketId) {
  return request(`/api/tickets/${ticketId}`);
}

export function approveTicket(ticketId, draftStyle, editedText) {
  const body = { ticket_id: ticketId, draft_style: draftStyle };
  if (editedText != null && editedText !== '') body.edited_text = editedText;
  return request('/api/approve', { method: 'POST', body: JSON.stringify(body) });
}

export function rejectTicket(ticketId, reason, freeText) {
  const body = { ticket_id: ticketId, reason };
  if (freeText != null && freeText !== '') body.free_text = freeText;
  return request('/api/reject', { method: 'POST', body: JSON.stringify(body) });
}

export function getAudit(ticketId) {
  return request(`/api/audit/${ticketId}`);
}

export function getHealth() {
  return request('/api/health');
}

// ---------------------------------------------------------------------------
// Auth (SPEC_AUTH_ONBOARDING §1)
// ---------------------------------------------------------------------------

export function getCaptcha() {
  return request('/api/auth/captcha');
}

export function signup(name, email, password, captchaId, captchaText) {
  return request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name, email, password,
      captcha_id: captchaId, captcha_text: captchaText,
    }),
  });
}

export function login(email, password, captchaId, captchaText) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email, password,
      captcha_id: captchaId, captcha_text: captchaText,
    }),
  });
}

export function getMe() {
  return request('/api/auth/me');
}

// ---------------------------------------------------------------------------
// Onboarding coordinator (SPEC_AUTH_ONBOARDING §3)
// ---------------------------------------------------------------------------

export const ONBOARDING_ROLES = [
  'Support Agent',
  'Engineer',
  'Finance Analyst',
  'People Ops',
  'Sales Rep',
];

export function createOnboardingPlan(hireName, role, startDate, notes) {
  const body = { hire_name: hireName, role, start_date: startDate };
  if (notes != null && notes !== '') body.notes = notes;
  return request('/api/onboarding/plans', { method: 'POST', body: JSON.stringify(body) });
}

export function listOnboardingPlans() {
  return request('/api/onboarding/plans');
}

export function getOnboardingPlan(planId) {
  return request(`/api/onboarding/plans/${planId}`);
}

export function setOnboardingTaskStatus(taskId, status, blockerReason) {
  const body = { status };
  if (blockerReason != null && blockerReason !== '') body.blocker_reason = blockerReason;
  return request(`/api/onboarding/tasks/${taskId}/status`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getOnboardingAudit(planId) {
  return request(`/api/onboarding/audit/${planId}`);
}
