import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import * as Code from '../src/Code.js';

// Property-based tests (fast-check). The overarching contracts:
//  - desiredSyncRules / planSync never throw on deformed outside
//    input, and never fabricate an announcement (no "NaN:NaN" rule,
//    no lone surrogate reaching encodeURIComponent).
//  - callGroq always returns a string, whatever the wrapper / API
//    does, because refreshMessageText branches on that string.
//  - Well-formed inputs keep byte-identical behaviour.

const API_URL = 'http://home-api.example/speak/-s/';
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UNSTRINGIFIABLE = { toString: [] };
const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

// A sheet cell / JSON field can be any of these. The unstringifiable
// object is a legitimate JSON-domain member (an object whose
// toString is not a function) and is included explicitly.
const cellValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.date({ noInvalidDate: true }),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(UNSTRINGIFIABLE),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.record({ note: fc.string() })
);

const validDate = fc.date({
  min: new Date(2000, 0, 1),
  max: new Date(2099, 11, 31, 23, 59),
  noInvalidDate: true,
});

describe('property-based tests', () => {
  const mockFetch = vi.fn();
  const mockGetProperty = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('UrlFetchApp', { fetch: mockFetch });
    vi.stubGlobal('Logger', { log: vi.fn() });
    vi.stubGlobal('PropertiesService', {
      getScriptProperties: () => ({ getProperty: mockGetProperty }),
    });
    mockGetProperty.mockImplementation((key) =>
      key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null
    );
  });

  it('desiredSyncRules never throws and only emits well-formed time keys and encodings', () => {
    const rowArb = fc.oneof(
      fc.tuple(
        fc.oneof(validDate, fc.constant(new Date(NaN)), cellValue),
        cellValue
      ),
      cellValue,
      fc.array(cellValue, { maxLength: 4 })
    );
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 8 }), (rows) => {
        const desired = Code.desiredSyncRules(rows, API_URL);
        for (const [key, entry] of Object.entries(desired)) {
          expect(key).toMatch(TIME_KEY);
          expect(typeof entry.command).toBe('string');
          const spoken = decodeURIComponent(entry.command.split(' ').pop());
          expect(spoken).not.toMatch(LONE_SURROGATE);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('desiredSyncRules round-trips well-formed rows (last row wins on duplicate times)', () => {
    // Texts are non-empty: an empty text cell is not a valid task at
    // all (isValidTask), so it belongs to the abnormal domain, not to
    // this well-formed round-trip. Whitespace-only texts stay in
    // domain — they are the documented time-signal-only form.
    const slot = fc.record({
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      text: fc.string({ unit: 'grapheme', minLength: 1 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(slot, {
          minLength: 1,
          maxLength: 6,
          selector: (s) => `${s.hour}:${s.minute}`,
        }),
        fc.option(fc.string({ unit: 'grapheme', minLength: 1 }), { nil: undefined }),
        (slots, duplicateText) => {
          const rows = slots.map((s) => [
            new Date(2026, 10, 2, s.hour, s.minute),
            s.text,
          ]);
          if (duplicateText !== undefined) {
            const first = slots[0];
            rows.push([new Date(2026, 10, 2, first.hour, first.minute), duplicateText]);
          }
          const desired = Code.desiredSyncRules(rows, API_URL);
          const expectedKeys = slots.map(
            (s) =>
              `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
          );
          expect(Object.keys(desired).sort()).toEqual([...expectedKeys].sort());
          for (const s of slots) {
            const key = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
            const isDuplicate = duplicateText !== undefined && s === slots[0];
            const text = isDuplicate ? duplicateText : s.text;
            const effective = text.trim() === '' ? '' : text;
            const message = Code.buildSpeakingMessage(
              new Date(2026, 10, 2, s.hour, s.minute),
              effective
            );
            expect(desired[key].command).toBe(
              Code.buildSyncSpeechCommand(API_URL, message)
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('planSync never throws on deformed maps and keeps its coverage invariants', () => {
    const timeKey = fc.constantFrom('07:00', '07:30', '08:00', '19:00');
    const id = fc.constantFrom('r1', 'r2', 'r3', 'rx');
    const storedArb = fc.dictionary(
      timeKey,
      fc.oneof(
        fc.constant(null),
        fc.record({ id, command: fc.constantFrom('cmd-a', 'cmd-b') })
      ),
      { maxKeys: 4 }
    );
    const desiredArb = fc.dictionary(
      timeKey,
      fc.record({ command: fc.constantFrom('cmd-a', 'cmd-b') }),
      { maxKeys: 4 }
    );
    const currentArb = fc.oneof(
      fc.array(fc.oneof(fc.constant(null), fc.constant(5), fc.record({ id })), {
        maxLength: 5,
      }),
      fc.constant(null),
      fc.constant({}),
      fc.constant('x')
    );
    fc.assert(
      fc.property(desiredArb, storedArb, currentArb, (desired, stored, current) => {
        const plan = Code.planSync(desired, stored, current);
        const currentIds = new Set(
          (Array.isArray(current) ? current : [])
            .map((rule) => (rule ? rule.id : undefined))
            .filter((x) => x !== undefined)
        );
        for (const [time, entry] of Object.entries(plan.kept)) {
          expect(stored[time]).toEqual(entry);
          expect(desired[time].command).toBe(entry.command);
          expect(currentIds.has(entry.id)).toBe(true);
        }
        for (const deletedId of plan.toDelete) {
          expect(currentIds.has(deletedId)).toBe(true);
        }
        for (const created of plan.toCreate) {
          expect(desired[created.time].command).toBe(created.command);
        }
        const covered = new Set([
          ...Object.keys(plan.kept),
          ...plan.toCreate.map((c) => c.time),
        ]);
        expect(covered).toEqual(new Set(Object.keys(desired)));
      }),
      { numRuns: 100 }
    );
  });

  it('buildSpeakingMessage always renders the 12-hour spoken form', () => {
    fc.assert(
      fc.property(validDate, fc.string({ unit: 'grapheme' }), (date, text) => {
        const hour = date.getHours() % 12 || 12;
        const minute = date.getMinutes();
        const expected = `${hour}時${minute ? `${minute}分` : 'ちょうど'}です。${text}`;
        expect(Code.buildSpeakingMessage(date, text)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('buildSyncSpeechCommand is byte-identical for well-formed messages', () => {
    const urlArb = fc.constantFrom(
      'http://home-api.example/speak/-s/',
      'https://home-api.example/google-home-speaker-wrapper/-h/192.0.2.22/-v/60/-s/',
      'http://home-api.example/'
    );
    fc.assert(
      fc.property(urlArb, fc.string({ unit: 'grapheme' }), (url, message) => {
        const segments = url
          .replace(/^https?:\/\/[^/]+/i, '')
          .split('/')
          .filter((s) => s.length > 0)
          .join(' ');
        expect(Code.buildSyncSpeechCommand(url, message)).toBe(
          `${segments} ${encodeURIComponent(message)}`
        );
      }),
      { numRuns: 100 }
    );
  });

  it('buildSyncSpeechCommand never throws and never emits a lone surrogate', () => {
    const messageArb = fc.oneof(
      fc.string(),
      fc.constant('\uD800'),
      fc.constant('a\uDC00b'),
      fc.constant('\uD800\uD800\uDC00'),
      cellValue
    );
    fc.assert(
      fc.property(messageArb, (message) => {
        const command = Code.buildSyncSpeechCommand(API_URL, message);
        const spoken = decodeURIComponent(command.split(' ').pop());
        expect(spoken).not.toMatch(LONE_SURROGATE);
      }),
      { numRuns: 100 }
    );
  });

  it('callGroq always returns a string for arbitrary wrapper bodies', () => {
    const bodyArb = fc.oneof(
      fc.string(),
      fc.jsonValue().map((v) => JSON.stringify(v))
    );
    fc.assert(
      fc.property(bodyArb, (body) => {
        mockFetch.mockReturnValue({ getContentText: () => body });
        const result = Code.callGroq('prompt');
        expect(typeof result).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('callGroq always returns an Error string for arbitrary thrown fetch failures', () => {
    const thrownArb = fc.oneof(
      fc.constant(new Error('boom')),
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(UNSTRINGIFIABLE),
      fc.record({ code: fc.integer() })
    );
    fc.assert(
      fc.property(thrownArb, (thrown) => {
        mockFetch.mockImplementation(() => {
          throw thrown;
        });
        const result = Code.callGroq('prompt');
        expect(typeof result).toBe('string');
        expect(result).toMatch(/^Error: /);
      }),
      { numRuns: 100 }
    );
  });

  it('callGroq returns a well-formed wrapper answer trimmed and unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme' }).filter((s) => !/<think/i.test(s)),
        (answer) => {
          mockFetch.mockReturnValue({
            getContentText: () => JSON.stringify({ answer, cached: false }),
          });
          expect(Code.callGroq('prompt')).toBe(answer.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});
