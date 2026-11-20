import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Code from '../src/Code.js';

// Abnormal-case tests: the inputs from outside this script are the
// hand-edited sheet (cells can hold anything), the groq-gas wrapper /
// Groq API responses (arbitrary JSON), the alarm app's rule list, and
// the persisted sync map. One deformed item must never kill the whole
// refresh or sync, and a deformed value must never be "repaired" into
// a fabricated announcement. Well-formed inputs keep byte-identical
// behaviour; those pins are marked as such.

const API_URL = 'http://home-api.example/speak/-s/';
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UNSTRINGIFIABLE = { toString: [] };

describe('abnormal cases', () => {
  const mockGetValues = vi.fn();
  const mockSetValues = vi.fn();
  const mockFetch = vi.fn();
  const mockGetProperty = vi.fn();
  const store = {};

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(store).forEach((key) => delete store[key]);

    vi.stubGlobal('SpreadsheetApp', {
      getActiveSheet: () => ({
        getDataRange: () => ({ getValues: mockGetValues, setValues: mockSetValues }),
      }),
    });
    vi.stubGlobal('UrlFetchApp', { fetch: mockFetch });
    vi.stubGlobal('Logger', { log: vi.fn() });
    vi.stubGlobal('PropertiesService', {
      getScriptProperties: () => ({
        getProperty: mockGetProperty,
        setProperty: (key, value) => {
          store[key] = value;
        },
      }),
    });
    mockGetProperty.mockImplementation((key) =>
      key === 'SPEAKER_API_URL' ? API_URL : store[key] ?? null
    );
  });

  describe('sheet rows: time validation', () => {
    it('rejects an Invalid Date as a scheduled time', () => {
      // An Invalid Date is still `instanceof Date`; without a NaN
      // check it became a rule keyed "NaN:NaN" announcing
      // "12時ちょうどです" — a fabricated announcement.
      expect(Code.isValidTask(new Date(NaN), 'おはよう')).toBe(false);
      expect(Code.isValidTask(new Date('not a date'), 'おはよう')).toBe(false);
    });

    it('drops invalid-Date rows but keeps valid sibling rows', () => {
      const desired = Code.desiredSyncRules(
        [
          [new Date(NaN), 'おはよう'],
          [new Date(2026, 10, 2, 7, 30), '朝ごはんです'],
        ],
        API_URL
      );
      expect(Object.keys(desired)).toEqual(['07:30']);
    });
  });

  describe('sheet rows: deformed rows must not kill the sync', () => {
    it('skips null and scalar rows, keeping valid rows', () => {
      const rows = [
        null,
        5,
        true,
        {},
        'ab',
        [new Date(2026, 10, 2, 7, 0), '朝ごはんです'],
      ];
      let desired;
      expect(() => {
        desired = Code.desiredSyncRules(rows, API_URL);
      }).not.toThrow();
      expect(Object.keys(desired)).toEqual(['07:00']);
    });

    it('treats a non-array rows argument as no rows', () => {
      expect(Code.desiredSyncRules(5, API_URL)).toEqual({});
      expect(Code.desiredSyncRules('ab', API_URL)).toEqual({});
      expect(Code.desiredSyncRules({}, API_URL)).toEqual({});
    });

    it('reads an unstringifiable message cell as empty instead of throwing', () => {
      // Sheets cells are scalars or Dates today, so this shape cannot
      // arrive from the grid; the row reader is still kept total so a
      // future cell type cannot wedge the whole sync. The row degrades
      // to the time-signal-only form, like a whitespace-only text.
      const desired = Code.desiredSyncRules(
        [[new Date(2026, 10, 2, 7, 30), UNSTRINGIFIABLE]],
        API_URL
      );
      expect(desired['07:30'].command).toBe(
        'speak -s ' + encodeURIComponent('7時30分です。')
      );
    });

    it('speaks a numeric message cell verbatim (pin of existing behaviour)', () => {
      const desired = Code.desiredSyncRules([[new Date(2026, 10, 2, 7, 30), 123]], API_URL);
      expect(desired['07:30'].command).toBe(
        'speak -s ' + encodeURIComponent('7時30分です。123')
      );
    });
  });

  describe('spoken text encoding', () => {
    it('replaces a lone surrogate in the sheet text with U+FFFD instead of throwing URIError', () => {
      let desired;
      expect(() => {
        desired = Code.desiredSyncRules(
          [[new Date(2026, 10, 2, 7, 30), 'おは\uD800よう']],
          API_URL
        );
      }).not.toThrow();
      const encoded = desired['07:30'].command.split(' ').pop();
      const spoken = decodeURIComponent(encoded);
      expect(spoken).toBe('7時30分です。おは\uFFFDよう');
      expect(spoken).not.toMatch(LONE_SURROGATE);
    });

    it('keeps a well-formed surrogate pair byte-identical (pin)', () => {
      const command = Code.buildSyncSpeechCommand(API_URL, '朝です🎉');
      expect(command).toBe('speak -s ' + encodeURIComponent('朝です🎉'));
    });

    it('replaces a lone low surrogate in a direct message instead of throwing', () => {
      const command = Code.buildSyncSpeechCommand(API_URL, 'a\uDC00b');
      expect(decodeURIComponent(command.split(' ').pop())).toBe('a\uFFFDb');
    });
  });

  describe('planSync: deformed stored map and alarm rule list', () => {
    it('tolerates a null stored entry for a time that is no longer desired', () => {
      // The second loop of planSync read prev.id unguarded, so one
      // null entry in the persisted map killed every later sync.
      let plan;
      expect(() => {
        plan = Code.planSync({}, { '07:00': null }, [{ id: 'r1' }]);
      }).not.toThrow();
      expect(plan).toEqual({ toDelete: [], toCreate: [], kept: {} });
    });

    it('tolerates null entries in the alarm rule list', () => {
      const stored = { '07:00': { id: 'r1', command: 'cmd-a' } };
      const plan = Code.planSync({}, stored, [null, { id: 'r1' }, 5]);
      expect(plan.toDelete).toEqual(['r1']);
    });

    it('treats a non-array alarm rule list as no current rules', () => {
      const desired = { '07:00': { command: 'cmd-a' } };
      expect(Code.planSync(desired, {}, {}).toCreate).toEqual([
        { time: '07:00', command: 'cmd-a' },
      ]);
      expect(Code.planSync(desired, {}, 'x').toCreate).toEqual([
        { time: '07:00', command: 'cmd-a' },
      ]);
    });

    it('recreates a desired rule whose stored entry is null (pin)', () => {
      const plan = Code.planSync({ '07:00': { command: 'cmd-a' } }, { '07:00': null }, []);
      expect(plan.toCreate).toEqual([{ time: '07:00', command: 'cmd-a' }]);
      expect(plan.kept).toEqual({});
    });
  });

  describe('groq-gas wrapper / Groq responses', () => {
    const useWrapper = () => {
      mockGetProperty.mockImplementation((key) =>
        key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null
      );
    };
    const useDirect = () => {
      mockGetProperty.mockImplementation((key) => (key === 'GROQ_API_KEY' ? 'test-key' : null));
    };
    const fetchBody = (body) =>
      mockFetch.mockReturnValue({ getContentText: () => body });

    it('wrapper: a thrown value whose toString is not a function still yields an Error string', () => {
      // The catch blocks rendered failures with e.toString(); a
      // thrown value without a callable toString made the error
      // handler itself throw, out of callGroq and refreshMessageText.
      useWrapper();
      mockFetch.mockImplementation(() => {
        throw UNSTRINGIFIABLE;
      });
      let result;
      expect(() => {
        result = Code.callGroq('prompt');
      }).not.toThrow();
      expect(result).toMatch(/^Error: /);
    });

    it('direct: a thrown value whose toString is not a function still yields an Error string', () => {
      useDirect();
      mockFetch.mockImplementation(() => {
        throw UNSTRINGIFIABLE;
      });
      expect(Code.callGroq('prompt')).toMatch(/^Error: /);
    });

    it('listGroqModels: a thrown value whose toString is not a function still yields an Error string', () => {
      mockFetch.mockImplementation(() => {
        throw UNSTRINGIFIABLE;
      });
      expect(Code.listGroqModels()).toMatch(/^Error: /);
    });

    it('wrapper: a numeric answer is an invalid-format error, never a spoken text (pin)', () => {
      useWrapper();
      fetchBody(JSON.stringify({ answer: 42 }));
      expect(Code.callGroq('prompt')).toBe('Error: Invalid response format from groq-gas');
    });

    it('wrapper: non-object JSON bodies are invalid-format errors (pin)', () => {
      useWrapper();
      for (const body of ['null', '"text"', '42', '[1,2]']) {
        fetchBody(body);
        expect(Code.callGroq('prompt')).toBe('Error: Invalid response format from groq-gas');
      }
    });

    it('wrapper: a non-string error field is stringified (pin)', () => {
      useWrapper();
      fetchBody(JSON.stringify({ error: ['a', 'b'] }));
      expect(Code.callGroq('prompt')).toBe('Error: ["a","b"]');
    });

    it('direct: numeric or null content degrades to an Error string (pin)', () => {
      useDirect();
      fetchBody(JSON.stringify({ choices: [{ message: { content: 42 } }] }));
      expect(Code.callGroq('prompt')).toMatch(/^Error: /);
      fetchBody(JSON.stringify({ choices: [{ message: { content: null } }] }));
      expect(Code.callGroq('prompt')).toMatch(/^Error: /);
    });

    it('direct: deformed choices are invalid-format errors (pin)', () => {
      useDirect();
      fetchBody(JSON.stringify({ choices: 'x' }));
      expect(Code.callGroq('prompt')).toBe('Error: Invalid response format from Groq API');
      fetchBody(JSON.stringify({ choices: [null] }));
      expect(Code.callGroq('prompt')).toBe('Error: Invalid response format from Groq API');
    });
  });

  describe('refreshMessageText', () => {
    it('keeps the original text when the rephrasing strips down to empty', () => {
      // An answer that is only a <think> block strips to '', and the
      // refresh used to write that '' over the hand-written message —
      // data loss in the source-of-truth sheet. An empty rephrasing
      // is "no rephrasing", like an Error: result.
      mockGetProperty.mockImplementation((key) =>
        key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null
      );
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({ answer: '<think>thinking only</think>' }),
      });
      const date = new Date(2026, 10, 2, 7, 0);
      mockGetValues.mockReturnValue([[date, 'おはよう', 'keep']]);

      Code.refreshMessageText();

      expect(mockSetValues).toHaveBeenCalledWith([[date, 'おはよう', 'keep']]);
    });
  });

  describe('syncTimetableToAlarm end to end', () => {
    let fetchBodies;

    beforeEach(() => {
      store.ALARM_EXEC_URL = 'https://alarm.example/exec';
      store.ALARM_SYNC_TOKEN = 'sync-token-1';
      fetchBodies = [];
      vi.stubGlobal('LockService', {
        getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
      });
    });

    const alarmFetch = (listResult) =>
      mockFetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.payload);
        fetchBodies.push(body);
        const result =
          body.action === 'list_rules'
            ? listResult
            : body.action === 'set_rule'
              ? { ok: true, rule: { id: `id-${body.time}` } }
              : { ok: true, deleted: 1 };
        return { getContentText: () => JSON.stringify(result) };
      });

    it('syncs the valid rows even when the sheet and the rule list contain deformed items', () => {
      mockGetValues.mockReturnValue([
        null,
        [new Date(NaN), 'おはよう'],
        [new Date(2026, 10, 2, 7, 30), 'おは\uD800よう'],
        [new Date(2026, 10, 2, 19, 0), '夕ごはんです'],
      ]);
      alarmFetch({ ok: true, rules: [null, { id: 'unrelated' }] });

      expect(() => Code.syncTimetableToAlarm()).not.toThrow();

      const sets = fetchBodies.filter((b) => b.action === 'set_rule');
      expect(sets.map((b) => b.time).sort()).toEqual(['07:30', '19:00']);
      const map = JSON.parse(store.ALARM_SYNC_MAP);
      expect(Object.keys(map).sort()).toEqual(['07:30', '19:00']);
    });

    it('completes when the persisted sync map contains a null entry', () => {
      store.ALARM_SYNC_MAP = JSON.stringify({ '07:00': null });
      mockGetValues.mockReturnValue([]);
      alarmFetch({ ok: true, rules: [{ id: 'r1' }] });

      expect(() => Code.syncTimetableToAlarm()).not.toThrow();
      expect(JSON.parse(store.ALARM_SYNC_MAP)).toEqual({});
    });
  });
});
