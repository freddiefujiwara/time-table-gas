// Base URL for Google Home speaker API
const API_URL = 'http://a.ze.gs/google-home-speaker-wrapper/-h/192.168.1.22/-v/60/-s/';

// Allow time difference (35 seconds)
const THRESHOLD = 35 * 1000;

function myFunction() {

  // Get current time
  const now = new Date();

  // Read all rows from the sheet
  SpreadsheetApp
    .getActiveSheet()
    .getDataRange()
    .getValues()
    .forEach(r => {

      // r[0] = time, r[1] = text
      // Skip if time is not Date or text is empty
      if (!(r[0] instanceof Date) || !r[1]) return;

      // Make "today at this time"
      const t = new Date(now);

      // Copy hour, minute, second from the sheet time
      t.setHours(
        r[0].getHours(),
        r[0].getMinutes(),
        r[0].getSeconds(),
        0
      );

      // Skip if time is too far from now
      if (Math.abs(now - t) > THRESHOLD) return;

      // Change hour to 12-hour format
      const h = t.getHours() % 12 || 12;

      // Get minutes
      const m = t.getMinutes();

      // Make message for speaker
      const message =
        `${h}時${m ? m + '分' : 'ちょうど'}です。${r[1]}`;

      // Call API to speak the message
      const res = UrlFetchApp.fetch(
        API_URL + encodeURIComponent(message),
        {
          // Use GET method
          method: 'get',

          // Do not stop script on HTTP error
          muteHttpExceptions: true,
        }
      );
      Logger.log(`Response (${res.getResponseCode()}): ${res.getContentText()} : ${message}`);
    });
}