/**
 * Base URL for Google Home speaker API
 */
export const API_URL = 'http://a.ze.gs/google-home-speaker-wrapper/-h/192.168.1.22/-v/60/-s/';

/**
 * Allow time difference (35 seconds)
 */
export const THRESHOLD = 35 * 1000;

/**
 * Main entry point for the script
 */
export function myFunction() {
  processScheduledTasks();
}

/**
 * Handles GET requests and returns scheduled tasks as JSON
 */
export function doGet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const rows = sheet.getDataRange().getValues();

  const tasks = rows
    .filter(([scheduledTime, messageText]) => isValidTask(scheduledTime, messageText))
    .map(([scheduledTime, messageText]) => ({
      scheduledTime: scheduledTime.toISOString(),
      messageText
    }));

  return ContentService.createTextOutput(JSON.stringify(tasks))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reads the spreadsheet and processes tasks that should be spoken
 */
export function processScheduledTasks() {
  const now = new Date();
  const sheet = SpreadsheetApp.getActiveSheet();
  const rows = sheet.getDataRange().getValues();

  rows.forEach((row, index) => {
    const [scheduledTime, messageText] = row;
    if (!isValidTask(scheduledTime, messageText)) {
      return;
    }

    const targetTime = getTargetTimeToday(now, scheduledTime);
    if (!isTimeWithinThreshold(now, targetTime, THRESHOLD)) {
      return;
    }

    const message = buildSpeakingMessage(targetTime, messageText);
    const response = callSpeakerApi(message);

    Logger.log(`Response (${response.getResponseCode()}): ${response.getContentText()} : ${message}`);
  });
}

/**
 * Validates if the row contains a valid date and message text
 * @param {any} scheduledTime
 * @param {any} messageText
 * @returns {boolean}
 */
export function isValidTask(scheduledTime, messageText) {
  return (scheduledTime instanceof Date) && !!messageText;
}

/**
 * Creates a Date object for today with the hours, minutes, and seconds from the scheduled time
 * @param {Date} now
 * @param {Date} scheduledTime
 * @returns {Date}
 */
export function getTargetTimeToday(now, scheduledTime) {
  const target = new Date(now);
  target.setHours(
    scheduledTime.getHours(),
    scheduledTime.getMinutes(),
    scheduledTime.getSeconds(),
    0
  );
  return target;
}

/**
 * Checks if the difference between now and target time is within the threshold
 * @param {Date} now
 * @param {Date} targetTime
 * @param {number} threshold
 * @returns {boolean}
 */
export function isTimeWithinThreshold(now, targetTime, threshold) {
  return Math.abs(now.getTime() - targetTime.getTime()) <= threshold;
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
 * Calls the speaker API with the encoded message
 * @param {string} message
 * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
export function callSpeakerApi(message) {
  return UrlFetchApp.fetch(
    API_URL + encodeURIComponent(message),
    {
      method: 'get',
      muteHttpExceptions: true,
    }
  );
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
      Logger.log(cleaned);
      return [scheduledTime, cleaned, ...rest];
    }
    return row;
  });

  range.setValues(updatedValues);
}

/**
 * Groq API call
 */
export function callGroq(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  const apiUrl = "https://api.groq.com/openai/v1/chat/completions";

  const payload = {
    "model": "llama-3.3-70b-versatile",
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
    return json.choices[0].message.content;
  } catch (e) {
    return "Error: " + e.toString();
  }
}
