/**
 * Speaker API URL prefix. The real value (which contains a home
 * server host and a LAN address) lives in the script property
 * SPEAKER_API_URL, not in this public source code.
 */
export const getSpeakerApiUrl = () => {
  const url = PropertiesService.getScriptProperties().getProperty('SPEAKER_API_URL');
  if (!url) {
    throw new Error('script property SPEAKER_API_URL is not set');
  }
  return url;
};

/**
 * The web endpoint used to return the whole announcement timetable —
 * the household's daily routine — to anyone who knew the /exec URL,
 * with no authentication. Nothing in the current system consumes it
 * (the timetable is edited in the sheet and synced to alarm-gas by the
 * trigger-driven path below), so it is disabled. The stub stays so old
 * callers get a clear error instead of the data.
 */
export function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: 'this endpoint is disabled' })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Total text coercion for values that arrive from outside this
 * script (sheet cells, API payloads): strings pass through, other
 * scalars stringify exactly as String() would, and a value whose
 * toString is not callable reads as empty instead of throwing and
 * taking the whole refresh / sync down with it.
 */
function cellText_(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return String(value);
  } catch (e) {
    return '';
  }
}

/**
 * Total error rendering for catch blocks: a thrown value whose
 * toString is not callable must not make the error handler itself
 * throw. Real errors render exactly as e.toString() did.
 */
function errorText_(e) {
  try {
    return e.toString();
  } catch (ignored) {
    return 'Unknown error';
  }
}

/**
 * Validates if the row contains a valid date and message text
 * @param {any} scheduledTime
 * @param {any} messageText
 * @returns {boolean}
 */
export function isValidTask(scheduledTime, messageText) {
  // An Invalid Date is still `instanceof Date`; without the NaN
  // check it produced a rule keyed "NaN:NaN" announcing
  // "12時ちょうどです" — a fabricated announcement.
  return (
    (scheduledTime instanceof Date) &&
    !Number.isNaN(scheduledTime.getTime()) &&
    !!messageText
  );
}

/**
 * Builds the message to be spoken by the speaker
 * @param {Date} time
 * @param {string} text
 * @returns {string}
 */
export function buildSpeakingMessage(time, text) {
  const hour = time.getHours() % 12 || 12;
  const minute = time.getMinutes();
  const minutePart = minute ? `${minute}分` : 'ちょうど';
  return `${hour}時${minutePart}です。${text}`;
}

/**
 * Cleans spaces from the message text and updates the spreadsheet if not empty.
 */
export function refreshMessageText() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const range = sheet.getDataRange();
  const values = range.getValues();

  const updatedValues = values.map(row => {
    // Preserve all columns in the row
    const [scheduledTime, messageText, ...rest] = row;
    if (typeof messageText !== 'string') return row;

    const cleaned = messageText.replace(/[\s\u3000]/g, '');
    if (cleaned !== '') {
      const rephrased = callGroq(`${cleaned}」を似たニュアンスで言い換えた文言のみ返せ。解説不要。`);
      Logger.log(`${cleaned} -> ${rephrased}`);
      // An answer that is only a <think> block strips down to '';
      // writing that back would erase the hand-written message, so
      // an empty rephrasing keeps the row, like an Error: result.
      if (typeof rephrased !== 'string' || rephrased === '' || rephrased.startsWith("Error:")) {
        return row;
      }
      return [scheduledTime, rephrased, ...rest];
    }
    return row;
  });

  range.setValues(updatedValues);
}

/**
 * Groq call.
 * Prefers the shared groq-gas wrapper (script property GROQ_GAS_URL,
 * the wrapper's /exec URL) so the Groq API key and model live in one
 * place. Falls back to a direct Groq API call using GROQ_API_KEY /
 * GROQ_MODEL when GROQ_GAS_URL is not set.
 */
export function callGroq(prompt) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const wrapperUrl = scriptProperties.getProperty('GROQ_GAS_URL');
  if (wrapperUrl) {
    return callGroqViaWrapper(wrapperUrl, prompt, scriptProperties);
  }
  return callGroqDirect(scriptProperties, prompt);
}

function callGroqViaWrapper(wrapperUrl, prompt, scriptProperties) {
  const payload = { "p": prompt };
  // groq-gas requires the shared token from the GROQ_GAS_TOKEN script
  // property; send it when configured.
  const token = scriptProperties.getProperty('GROQ_GAS_TOKEN');
  if (token) {
    payload.token = token;
  }
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(wrapperUrl, options);
    const json = JSON.parse(response.getContentText());
    if (json && json.error) {
      return "Error: " + (typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
    }
    if (json && typeof json.answer === 'string') {
      return json.answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }
    return "Error: Invalid response format from groq-gas";
  } catch (e) {
    return "Error: " + errorText_(e);
  }
}

function callGroqDirect(scriptProperties, prompt) {
  const apiKey = scriptProperties.getProperty('GROQ_API_KEY');
  const model = scriptProperties.getProperty('GROQ_MODEL') || "llama-3.1-8b-instant";
  const apiUrl = "https://api.groq.com/openai/v1/chat/completions";

  const payload = {
    "model": model,
    "messages": [{"role": "user", "content": prompt}],
    "temperature": 0.7
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + apiKey },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());
    if (json && json.error) {
      return "Error: " + (json.error.message || JSON.stringify(json.error));
    }
    if (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content !== undefined) {
      const content = json.choices[0].message.content;
      return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }
    return "Error: Invalid response format from Groq API";
  } catch (e) {
    return "Error: " + errorText_(e);
  }
}

/**
 * --- Sync to the alarm app ---
 * The sheet stays the single editing surface and stays private to
 * this script: the alarm project never reads it. Instead, this
 * script mirrors every announcement row into a recurring rule in
 * the alarm app (via its sync-token API), and the alarm trigger
 * does the firing. The mapping from sheet time to alarm rule id is
 * kept in the ALARM_SYNC_MAP script property, so the sheet itself
 * is never written to by the sync.
 *
 * Required script properties:
 *   ALARM_EXEC_URL    the alarm web app /exec URL
 *   ALARM_SYNC_TOKEN  the same value as the alarm project's
 *                     SYNC_TOKEN property
 * Setup: run setupTimetableSync() once (installs an on-edit
 * trigger and an hourly trigger, then syncs immediately). This
 * script no longer fires the announcements itself: its firing
 * trigger and firing code were retired in November 2026, once the
 * alarm app had taken over and proved stable.
 */

/**
 * Builds the wire-form speech command the alarm app stores, from
 * this script's speaker API URL prefix and the spoken message:
 * "http://host/google-home-speaker-wrapper/-h/…/-v/60/-s/" plus a
 * message becomes "google-home-speaker-wrapper -h … -v 60 -s <…>".
 */
export function buildSyncSpeechCommand(apiUrl, message) {
  const path = String(apiUrl || '').replace(/^https?:\/\/[^/]+/i, '');
  const segments = path.split('/').filter((segment) => segment.length > 0);
  // encodeURIComponent throws URIError on a lone surrogate; speak it
  // as U+FFFD instead of letting one bad character kill the sync.
  // Well-formed text (pairs included) is byte-identical.
  const spoken = cellText_(message).replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD'
  );
  return `${segments.join(' ')} ${encodeURIComponent(spoken)}`;
}

/**
 * The desired alarm rules for the sheet rows, as a map of "HH:MM"
 * to { command }. Rows without a valid time or text are skipped,
 * a whitespace-only text means the time signal only, and when a
 * time appears twice the last row wins (the grid has unique times).
 */
export function desiredSyncRules(rows, apiUrl) {
  const desired = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    // One deformed row must not kill the whole sync.
    if (!Array.isArray(row)) {
      return;
    }
    const [scheduledTime, messageText] = row;
    if (!isValidTask(scheduledTime, messageText)) {
      return;
    }
    const hour = String(scheduledTime.getHours()).padStart(2, '0');
    const minute = String(scheduledTime.getMinutes()).padStart(2, '0');
    const rawText = cellText_(messageText);
    const text = rawText.trim() === '' ? '' : rawText;
    const message = buildSpeakingMessage(scheduledTime, text);
    desired.set(`${hour}:${minute}`, {
      command: buildSyncSpeechCommand(apiUrl, message),
    });
  });
  return Object.fromEntries(desired);
}

/**
 * Diffs the desired rules against the stored map and the rules the
 * alarm app currently holds. A stored rule is kept only when it
 * still exists in the alarm app and its command is unchanged;
 * anything else is deleted and (when still desired) recreated.
 */
export function planSync(desired, stored, currentRules) {
  const currentIds = new Set(
    (Array.isArray(currentRules) ? currentRules : []).map((rule) =>
      rule ? rule.id : undefined
    )
  );
  const toDelete = [];
  const toCreate = [];
  const kept = {};
  Object.entries(desired || {}).forEach(([time, entry]) => {
    const prev = (stored || {})[time];
    if (prev && currentIds.has(prev.id) && prev.command === entry.command) {
      kept[time] = prev;
      return;
    }
    if (prev && currentIds.has(prev.id)) {
      toDelete.push(prev.id);
    }
    toCreate.push({ time, command: entry.command });
  });
  Object.entries(stored || {}).forEach(([time, prev]) => {
    if (!desired || !(time in desired)) {
      if (prev && currentIds.has(prev.id)) {
        toDelete.push(prev.id);
      }
    }
  });
  return { toDelete, toCreate, kept };
}

/**
 * Calls the alarm web app with the sync token. UrlFetchApp follows
 * the web app redirect, so the JSON answer comes back directly.
 */
export function callAlarmApi(body) {
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty('ALARM_EXEC_URL');
  const token = properties.getProperty('ALARM_SYNC_TOKEN');
  if (!url || !token) {
    throw new Error('script properties ALARM_EXEC_URL / ALARM_SYNC_TOKEN are not set');
  }
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/plain',
    payload: JSON.stringify({ ...body, sync_token: token }),
    muteHttpExceptions: true,
  });
  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    throw new Error(`alarm API ${body.action} failed: ${result.error || 'unknown error'}`);
  }
  return result;
}

/**
 * Mirrors the sheet into alarm rules. Runs on sheet edits and
 * hourly; concurrent runs are skipped (the next run reconciles).
 */
export function syncTimetableToAlarm() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('timetable sync skipped: another run holds the lock');
    return;
  }
  try {
    const rows = SpreadsheetApp.getActiveSheet().getDataRange().getValues();
    const desired = desiredSyncRules(rows, getSpeakerApiUrl());
    const properties = PropertiesService.getScriptProperties();
    let stored = {};
    try {
      stored = JSON.parse(properties.getProperty('ALARM_SYNC_MAP') || '{}') || {};
    } catch (e) {
      stored = {};
    }
    const current = callAlarmApi({ action: 'list_rules' }).rules || [];
    const plan = planSync(desired, stored, current);
    plan.toDelete.forEach((id) => callAlarmApi({ action: 'delete_rule', id }));
    const nextMap = { ...plan.kept };
    plan.toCreate.forEach((item) => {
      const created = callAlarmApi({
        action: 'set_rule',
        time: item.time,
        commands: [item.command],
      });
      nextMap[item.time] = { id: created.rule.id, command: item.command };
    });
    properties.setProperty('ALARM_SYNC_MAP', JSON.stringify(nextMap));
    Logger.log(
      `timetable sync: kept ${Object.keys(plan.kept).length}, ` +
        `created ${plan.toCreate.length}, deleted ${plan.toDelete.length}`
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * One-time setup: (re)installs the sync triggers — on sheet edit
 * and hourly — and runs the first sync.
 */
export function setupTimetableSync() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'syncTimetableToAlarm') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('syncTimetableToAlarm').forSpreadsheet(spreadsheet).onEdit().create();
  ScriptApp.newTrigger('syncTimetableToAlarm').timeBased().everyHours(1).create();
  syncTimetableToAlarm();
}

/**
 * Utility function to list available Groq models for debugging
 */
export function listGroqModels() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('GROQ_API_KEY');
  const apiUrl = "https://api.groq.com/openai/v1/models";

  const options = {
    "method": "get",
    "headers": { "Authorization": "Bearer " + apiKey },
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const content = response.getContentText();
    Logger.log("Available Models: " + content);
    return content;
  } catch (e) {
    const errorMsg = "Error: " + errorText_(e);
    Logger.log(errorMsg);
    return errorMsg;
  }
}
