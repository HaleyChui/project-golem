const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DATA_DIR = path.resolve(process.cwd(), 'data', 'dashboard');
const DATA_PATH = path.join(DATA_DIR, 'collab-calendar.json');

const DEFAULT_STATE = {
  version: 1,
  updatedAt: null,
  settings: {
    timezone: 'Asia/Taipei',
    google: {
      enabled: false,
      apiKey: '',
      calendarId: 'primary',
      syncDirection: 'google_to_local',
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncMessage: '',
    },
  },
  events: [],
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeOwner(owner) {
  const normalized = safeString(owner).toLowerCase();
  if (normalized === 'golem') return 'golem';
  return 'user';
}

function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function makeId() {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureStateShape(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  return {
    version: Number(state.version) || 1,
    updatedAt: state.updatedAt || null,
    settings: {
      timezone: safeString(state.settings?.timezone, 'Asia/Taipei'),
      google: {
        enabled: toBool(state.settings?.google?.enabled),
        apiKey: safeString(state.settings?.google?.apiKey),
        calendarId: safeString(state.settings?.google?.calendarId, 'primary'),
        syncDirection: safeString(state.settings?.google?.syncDirection, 'google_to_local') || 'google_to_local',
        lastSyncAt: state.settings?.google?.lastSyncAt || null,
        lastSyncStatus: state.settings?.google?.lastSyncStatus || null,
        lastSyncMessage: safeString(state.settings?.google?.lastSyncMessage),
      },
    },
    events: Array.isArray(state.events) ? state.events : [],
  };
}

function loadState() {
  ensureDir();
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return ensureStateShape(raw);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function saveState(state) {
  ensureDir();
  const next = ensureStateShape(state);
  next.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeEvent(input, existing = null) {
  const title = safeString(input?.title);
  const start = normalizeDate(input?.start);
  const end = normalizeDate(input?.end);
  if (!title) throw new Error('Event title is required.');
  if (!start || !end) throw new Error('Event start/end must be valid datetime.');
  if (new Date(start).getTime() >= new Date(end).getTime()) throw new Error('Event end time must be after start time.');

  // reminderMinutes: 提前幾分鐘提醒，0 = 準時，null = 不提醒
  const rawReminder = input?.reminderMinutes !== undefined ? input.reminderMinutes : existing?.reminderMinutes;
  const reminderMinutes = rawReminder === null || rawReminder === undefined
    ? 10  // 預設提前 10 分鐘
    : Math.max(0, Math.min(10080, Number(rawReminder) || 0));

  return {
    id: existing?.id || safeString(input?.id) || makeId(),
    title,
    description: safeString(input?.description),
    location: safeString(input?.location),
    start,
    end,
    owner: normalizeOwner(input?.owner || existing?.owner),
    participants: Array.isArray(input?.participants)
      ? input.participants.map((item) => safeString(item)).filter(Boolean).slice(0, 20)
      : (existing?.participants || []),
    editableBy: {
      user: input?.editableBy?.user !== undefined ? toBool(input.editableBy.user) : existing?.editableBy?.user !== false,
      golem: input?.editableBy?.golem !== undefined ? toBool(input.editableBy.golem) : existing?.editableBy?.golem !== false,
    },
    source: safeString(input?.source || existing?.source, 'local'),
    sourceId: safeString(input?.sourceId || existing?.sourceId),
    allDay: toBool(input?.allDay ?? existing?.allDay),
    reminderMinutes,
    lastRemindedAt: existing?.lastRemindedAt || null, // 防止重複觸發
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
}

/**
 * 掃描即將到期的事件，回傳需要觸發提醒的清單，並標記 lastRemindedAt 防止重複。
 * @returns {{ event, triggerType: 'reminder'|'start' }[]}
 */
function checkDueReminders() {
  const state = loadState();
  const now = Date.now();
  const due = [];
  let dirty = false;

  for (const event of state.events) {
    // 全天事件不觸發提醒
    if (event.allDay) continue;
    // reminderMinutes 為 null 表示使用者明確關閉提醒
    if (event.reminderMinutes === null) continue;

    const startMs = new Date(event.start).getTime();
    const reminderMs = startMs - (event.reminderMinutes || 0) * 60 * 1000;

    // 已過去超過 1 小時的事件不再提醒
    if (startMs < now - 60 * 60 * 1000) continue;

    // 防止重複：若已在本次提醒視窗內觸發過，跳過
    if (event.lastRemindedAt) {
      const lastMs = new Date(event.lastRemindedAt).getTime();
      // 同一個提醒視窗（2 分鐘內）不重複觸發
      if (now - lastMs < 2 * 60 * 1000) continue;
    }

    // 提醒時間到了（在 now 的前後 1 分鐘視窗內）
    const inReminderWindow = reminderMs <= now && now <= reminderMs + 60 * 1000;
    // 準時觸發（事件開始時間的前後 1 分鐘）
    const inStartWindow = startMs <= now && now <= startMs + 60 * 1000;

    if (inReminderWindow || inStartWindow) {
      due.push({
        event,
        triggerType: inStartWindow && event.reminderMinutes === 0 ? 'start' : 'reminder',
      });
      // 標記已提醒，防止下一分鐘重複觸發
      event.lastRemindedAt = new Date().toISOString();
      dirty = true;
    }
  }

  if (dirty) saveState(state);
  return due;
}

function listEvents({ start, end, owner } = {}) {
  const state = loadState();
  const startDate = start ? normalizeDate(start) : null;
  const endDate = end ? normalizeDate(end) : null;

  const events = state.events.filter((event) => {
    if (owner && normalizeOwner(owner) !== event.owner) return false;
    if (startDate && new Date(event.end).getTime() < new Date(startDate).getTime()) return false;
    if (endDate && new Date(event.start).getTime() > new Date(endDate).getTime()) return false;
    return true;
  }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return { events, settings: state.settings, updatedAt: state.updatedAt };
}

function createEvent(payload) {
  const state = loadState();
  const event = normalizeEvent(payload);
  state.events.push(event);
  const saved = saveState(state);
  return { event, updatedAt: saved.updatedAt };
}

function updateEvent(id, payload) {
  const state = loadState();
  const index = state.events.findIndex((event) => event.id === id);
  if (index < 0) return null;
  const current = state.events[index];
  const event = normalizeEvent({ ...current, ...payload, id: current.id }, current);
  state.events[index] = event;
  const saved = saveState(state);
  return { event, updatedAt: saved.updatedAt };
}

function removeEvent(id) {
  const state = loadState();
  const initialLength = state.events.length;
  state.events = state.events.filter((event) => event.id !== id);
  if (state.events.length === initialLength) return false;
  saveState(state);
  return true;
}

function getSettings() {
  return loadState().settings;
}

function updateSettings(patch) {
  const state = loadState();
  if (patch?.timezone) state.settings.timezone = safeString(patch.timezone, state.settings.timezone);
  if (patch?.google && typeof patch.google === 'object') {
    const current = state.settings.google || {};
    state.settings.google = {
      ...current,
      enabled: patch.google.enabled !== undefined ? toBool(patch.google.enabled) : current.enabled,
      apiKey: patch.google.apiKey !== undefined ? safeString(patch.google.apiKey) : current.apiKey,
      calendarId: patch.google.calendarId !== undefined ? safeString(patch.google.calendarId, current.calendarId || 'primary') : current.calendarId,
      syncDirection: patch.google.syncDirection !== undefined ? safeString(patch.google.syncDirection, current.syncDirection || 'google_to_local') : current.syncDirection,
    };
  }
  const saved = saveState(state);
  return { settings: saved.settings, updatedAt: saved.updatedAt };
}

function exportAsJson() {
  const state = loadState();
  return {
    version: state.version,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    events: state.events,
  };
}

function toIcsDate(dateIso) {
  return new Date(dateIso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function exportAsIcs() {
  const state = loadState();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Project Golem//Collab Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const event of state.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(event.id)}@project-golem`);
    lines.push(`DTSTAMP:${toIcsDate(event.updatedAt || event.createdAt || new Date().toISOString())}`);
    lines.push(`DTSTART:${toIcsDate(event.start)}`);
    lines.push(`DTEND:${toIcsDate(event.end)}`);
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    lines.push(`CATEGORIES:${event.owner === 'golem' ? 'GOLEM' : 'USER'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function importFromJson(input) {
  const payload = input && typeof input === 'object' ? input : {};
  const incomingEvents = Array.isArray(payload.events) ? payload.events : [];
  const state = loadState();
  const map = new Map(state.events.map((event) => [event.id, event]));
  let imported = 0;

  for (const rawEvent of incomingEvents) {
    try {
      const existing = rawEvent?.id ? map.get(String(rawEvent.id)) : null;
      const normalized = normalizeEvent(rawEvent, existing);
      map.set(normalized.id, normalized);
      imported += 1;
    } catch {
      // skip invalid event
    }
  }

  state.events = Array.from(map.values()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  saveState(state);
  return { imported, total: state.events.length };
}

function parseIcsDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const hour = raw.slice(9, 11);
    const minute = raw.slice(11, 13);
    const second = raw.slice(13, 15);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function importFromIcs(icsText) {
  const text = String(icsText || '');
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  const items = [];

  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0] || '';
    const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const getVal = (key) => {
      const line = lines.find((item) => item.startsWith(`${key}:`));
      return line ? line.slice(key.length + 1).trim() : '';
    };

    const start = parseIcsDate(getVal('DTSTART'));
    const end = parseIcsDate(getVal('DTEND'));
    const title = getVal('SUMMARY');
    if (!start || !end || !title) continue;

    items.push({
      id: getVal('UID') || undefined,
      title,
      description: getVal('DESCRIPTION'),
      location: getVal('LOCATION'),
      start,
      end,
      owner: /GOLEM/i.test(getVal('CATEGORIES')) ? 'golem' : 'user',
      source: 'import-ics',
    });
  }

  return importFromJson({ events: items });
}

// ============================================================
// 🔐 Google OAuth2 雙向同步
// ============================================================

const OAUTH_TOKEN_PATH = path.join(DATA_DIR, 'google-oauth-token.json');

function loadOAuthToken() {
  ensureDir();
  if (!fs.existsSync(OAUTH_TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveOAuthToken(token) {
  ensureDir();
  fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
}

function clearOAuthToken() {
  if (fs.existsSync(OAUTH_TOKEN_PATH)) fs.unlinkSync(OAUTH_TOKEN_PATH);
}

function getOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/google/callback',
  };
}

function buildAuthUrl(state = '') {
  const { clientId, redirectUri } = getOAuthConfig();
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID 未設定。');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 未設定。');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error_description || `Token exchange failed (${response.status})`);

  const token = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || '',
  };
  saveOAuthToken(token);
  return token;
}

async function refreshAccessToken(token) {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 未設定。');
  if (!token?.refreshToken) throw new Error('No refresh token available. Please re-authorize.');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: token.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error_description || `Token refresh failed (${response.status})`);

  const updated = {
    ...token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  saveOAuthToken(updated);
  return updated;
}

async function getValidAccessToken() {
  let token = loadOAuthToken();
  if (!token) throw new Error('尚未完成 Google OAuth 授權。請先點擊「授權 Google」按鈕。');
  if (Date.now() >= token.expiresAt - 60000) {
    token = await refreshAccessToken(token);
  }
  return token.accessToken;
}

function getOAuthStatus() {
  const token = loadOAuthToken();
  const { clientId } = getOAuthConfig();
  return {
    configured: !!(clientId),
    authorized: !!(token?.refreshToken),
    expiresAt: token?.expiresAt || null,
    scope: token?.scope || null,
  };
}

async function syncFromGoogle() {
  const state = loadState();
  const googleSettings = state.settings?.google || {};
  if (!googleSettings.enabled) throw new Error('Google sync is disabled.');

  const calendarId = encodeURIComponent(googleSettings.calendarId || 'primary');
  const now = new Date();
  const timeMin = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString();
  const timeMax = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 180).toISOString();

  // 優先使用 OAuth token；若無則 fallback 到 API Key（唯讀公開日曆）
  let headers = { Accept: 'application/json' };
  let url;
  const oauthToken = loadOAuthToken();

  if (oauthToken?.refreshToken) {
    const accessToken = await getValidAccessToken();
    headers['Authorization'] = `Bearer ${accessToken}`;
    url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
  } else if (googleSettings.apiKey) {
    url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&key=${encodeURIComponent(googleSettings.apiKey)}`;
  } else {
    throw new Error('請先完成 Google OAuth 授權，或填入 API Key（僅限公開日曆）。');
  }

  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message || `Google sync failed (${response.status})`;
    state.settings.google.lastSyncAt = new Date().toISOString();
    state.settings.google.lastSyncStatus = 'failed';
    state.settings.google.lastSyncMessage = message;
    saveState(state);
    throw new Error(message);
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const imported = [];
  for (const item of items) {
    const start = item?.start?.dateTime || (item?.start?.date ? `${item.start.date}T00:00:00.000Z` : null);
    const end = item?.end?.dateTime || (item?.end?.date ? `${item.end.date}T23:59:59.000Z` : null);
    if (!start || !end || !item?.summary) continue;

    imported.push({
      id: `google_${item.id}`,
      sourceId: String(item.id || ''),
      source: 'google-calendar',
      title: String(item.summary),
      description: String(item.description || ''),
      location: String(item.location || ''),
      start,
      end,
      owner: 'user',
      editableBy: { user: true, golem: true },
      participants: [],
      allDay: !!item?.start?.date,
    });
  }

  const result = importFromJson({ events: imported });
  const nextState = loadState();
  nextState.settings.google.lastSyncAt = new Date().toISOString();
  nextState.settings.google.lastSyncStatus = 'success';
  nextState.settings.google.lastSyncMessage = `已從 Google Calendar 匯入 ${imported.length} 個事件。`;
  saveState(nextState);

  return {
    ...result,
    importedFromGoogle: imported.length,
    lastSyncAt: nextState.settings.google.lastSyncAt,
  };
}

async function pushEventToGoogle(event) {
  const accessToken = await getValidAccessToken();
  const state = loadState();
  const calendarId = encodeURIComponent(state.settings?.google?.calendarId || 'primary');

  const body = {
    summary: event.title,
    description: event.description || '',
    location: event.location || '',
    start: event.allDay
      ? { date: event.start.slice(0, 10) }
      : { dateTime: event.start, timeZone: state.settings?.timezone || 'Asia/Taipei' },
    end: event.allDay
      ? { date: event.end.slice(0, 10) }
      : { dateTime: event.end, timeZone: state.settings?.timezone || 'Asia/Taipei' },
  };

  // 若已有 Google sourceId，則 PATCH；否則 POST 新建
  if (event.source === 'google-calendar' && event.sourceId) {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(event.sourceId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `Google PATCH failed (${response.status})`);
    return data;
  } else {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `Google POST failed (${response.status})`);
    return data;
  }
}

async function deleteEventFromGoogle(sourceId) {
  const accessToken = await getValidAccessToken();
  const state = loadState();
  const calendarId = encodeURIComponent(state.settings?.google?.calendarId || 'primary');

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || `Google DELETE failed (${response.status})`);
  }
  return true;
}

function execAppleScript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(String(stdout || '').trim());
    });
  });
}

async function syncFromApple({ daysBefore = 30, daysAfter = 180 } = {}) {
  const before = Number.isFinite(Number(daysBefore)) ? Number(daysBefore) : 30;
  const after = Number.isFinite(Number(daysAfter)) ? Number(daysAfter) : 180;
  const escapedBefore = Math.max(0, Math.min(365, Math.floor(before)));
  const escapedAfter = Math.max(1, Math.min(365, Math.floor(after)));
  const script = `
set nowDate to (current date)
set startDate to nowDate - (${escapedBefore} * days)
set endDate to nowDate + (${escapedAfter} * days)
set output to ""
tell application "Calendar"
  repeat with aCalendar in calendars
    set calName to (name of aCalendar as text)
    set allEvents to (every event of aCalendar whose start date is greater than startDate and start date is less than endDate)
    repeat with anEvent in allEvents
      set evtId to (id of anEvent as text)
      set evtTitle to (summary of anEvent as text)
      set evtStart to (start date of anEvent as «class isot»)
      set evtEnd to (end date of anEvent as «class isot»)
      set evtLocation to ""
      try
        set evtLocation to (location of anEvent as text)
      end try
      set evtDesc to ""
      try
        set evtDesc to (description of anEvent as text)
      end try
      set output to output & evtId & "\\t" & calName & "\\t" & evtTitle & "\\t" & evtStart & "\\t" & evtEnd & "\\t" & evtLocation & "\\t" & evtDesc & "\\n"
    end repeat
  end repeat
end tell
return output
`;

  const raw = await execAppleScript(script);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const imported = [];

  for (const line of lines) {
    const [sourceId, calendarName, title, start, end, location, description] = line.split('\t');
    if (!sourceId || !title || !start || !end) continue;
    const startIso = normalizeDate(start);
    const endIso = normalizeDate(end);
    if (!startIso || !endIso) continue;
    imported.push({
      id: `apple_${sourceId}`,
      source: 'apple-calendar',
      sourceId: sourceId,
      title,
      start: startIso,
      end: endIso,
      location: location || '',
      description: description || '',
      owner: 'user',
      participants: calendarName ? [calendarName] : [],
      editableBy: { user: true, golem: true },
    });
  }

  const result = importFromJson({ events: imported });
  return { ...result, importedFromApple: imported.length };
}

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  removeEvent,
  getSettings,
  updateSettings,
  exportAsJson,
  exportAsIcs,
  importFromJson,
  importFromIcs,
  syncFromGoogle,
  syncFromApple,
  checkDueReminders,
  // Google OAuth2
  buildAuthUrl,
  exchangeCodeForToken,
  getOAuthStatus,
  clearOAuthToken,
  pushEventToGoogle,
  deleteEventFromGoogle,
};
