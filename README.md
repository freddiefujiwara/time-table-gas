# Groq GAS Scheduled Tasks

A Google Apps Script (GAS) project that processes scheduled tasks from a spreadsheet and triggers spoken notifications via an external speaker API. It also features AI-powered message rephrasing using the Groq API.

## Features

- **Scheduled Speaker Notifications**: Periodically checks a spreadsheet for tasks scheduled within a specific threshold (35 seconds) and sends them to a speaker API.
- **Web App API (`doGet`)**: Serves the list of scheduled tasks as a JSON response.
- **AI Rephrasing (`refreshMessageText`)**: Sanitizes message text by removing spaces and rephrases them using Groq (llama-3.1-8b-instant) to keep the notifications fresh.
- **100% Test Coverage**: High-quality code covered by a comprehensive Vitest suite.

## Project Structure

- `src/Code.js`: Main source code containing GAS logic.
- `test/Code.spec.js`: Unit tests using Vitest.
- `build.js`: Custom build script to prepare code for GAS deployment by stripping exports.
- `appsscript.json`: Manifest file for the Google Apps Script project.
- `openapi.yaml`: OpenAPI 3.0 specification for the Web App API.

## Setup

### Prerequisites

- Node.js installed.
- `clasp` installed globally (`npm install -g @google/clasp`).

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

1. Initialize `clasp` and link it to your Google Apps Script project:
   ```bash
   clasp login
   clasp create --title "Groq GAS Scheduled Tasks" --type sheets
   ```
2. Set the `GROQ_API_KEY` in your Script Properties:
   - Go to Project Settings in the GAS Editor.
   - Add a property named `GROQ_API_KEY` with your Groq API key.
   - (Optional) Add a property named `GROQ_MODEL` to specify a model (defaults to `llama-3.1-8b-instant`).

## Development

### Building

To generate the deployable `dist/Code.gs` file:
```bash
npm run build
```

### Testing

To run the unit tests with coverage:
```bash
npm test
```

### Deployment

To build and push the code to Google Apps Script:
```bash
npm run deploy
```

## API Documentation

The Web App API is documented in `openapi.yaml`. When deployed as a web app, the `doGet` function returns an array of scheduled tasks.

## License

This project is licensed under the MIT License.

## Script properties

These values live in the Apps Script project's script properties,
not in this repository:

- `SPEAKER_API_URL`: URL prefix of the speaker API (contains a home
  server host and a LAN address).
- `GROQ_API_KEY`, `GROQ_MODEL`: for the Groq rephrasing feature.
- `ALARM_EXEC_URL`, `ALARM_SYNC_TOKEN`: for the alarm sync below.
  The token must match the alarm project's `SYNC_TOKEN` property.

## Sync to the alarm app

The sheet remains the only editing surface and stays private to
this project — the alarm project never reads it. Instead,
`syncTimetableToAlarm()` mirrors each announcement row into a
recurring rule in the alarm app, and the alarm trigger does the
firing with the same "it is HH:MM. <text>" wording.

- The time-to-rule-id mapping lives in the `ALARM_SYNC_MAP` script
  property; the sync never writes to the sheet.
- `setupTimetableSync()` installs an on-edit trigger and an hourly
  trigger, then syncs immediately. Sheet edits therefore reach the
  alarm app within moments, and the hourly run heals any drift
  (for example a synced rule deleted in the alarm UI comes back).
- Cutover: after the properties above are set and
  `setupTimetableSync()` has run, check the rules in the alarm
  app, then run `stopTimetableFiring()` to remove this project's
  own firing triggers so announcements are not spoken twice.
