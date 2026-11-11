import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Code from '../src/Code.js';

describe('Code.js', () => {
  const mockGetActiveSheet = vi.fn();
  const mockGetDataRange = vi.fn();
  const mockGetValues = vi.fn();
  const mockFetch = vi.fn();
  const mockLog = vi.fn();
  const mockCreateTextOutput = vi.fn();
  const mockSetMimeType = vi.fn();
  const mockGetScriptProperties = vi.fn();
  const mockGetProperty = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('SpreadsheetApp', {
      getActiveSheet: mockGetActiveSheet,
    });
    mockGetActiveSheet.mockReturnValue({
      getDataRange: mockGetDataRange,
    });
    mockGetDataRange.mockReturnValue({
      getValues: mockGetValues,
    });

    vi.stubGlobal('UrlFetchApp', {
      fetch: mockFetch,
    });

    vi.stubGlobal('Logger', {
      log: mockLog,
    });

    vi.stubGlobal('ContentService', {
      createTextOutput: mockCreateTextOutput,
      MimeType: {
        JSON: 'application/json',
      },
    });

    vi.stubGlobal('PropertiesService', {
      getScriptProperties: mockGetScriptProperties,
    });
    mockGetScriptProperties.mockReturnValue({
      getProperty: mockGetProperty,
    });
    mockGetProperty.mockImplementation(key =>
      key === 'SPEAKER_API_URL' ? 'http://home-api.example/speak/-s/' : null
    );
    mockCreateTextOutput.mockReturnValue({
      setMimeType: mockSetMimeType,
    });
  });

  describe('doGet', () => {
    it('should return JSON representation of valid tasks', () => {
      const date1 = new Date('2023-10-01T10:00:00Z');
      const date2 = new Date('2023-10-01T12:00:00Z');
      mockGetValues.mockReturnValue([
        [date1, 'Task 1'],
        [date2, 'Task 2'],
        ['invalid', 'skip me'],
      ]);

      Code.doGet();

      expect(mockCreateTextOutput).toHaveBeenCalledWith(JSON.stringify([
        { scheduledTime: date1.toISOString(), messageText: 'Task 1' },
        { scheduledTime: date2.toISOString(), messageText: 'Task 2' },
      ]));
      expect(mockSetMimeType).toHaveBeenCalledWith('application/json');
    });
  });


  describe('isValidTask', () => {
    it('should return true for valid date and text', () => {
      expect(Code.isValidTask(new Date(), 'hello')).toBe(true);
    });

    it('should return false if scheduledTime is not a Date', () => {
      expect(Code.isValidTask('2023-10-01', 'hello')).toBe(false);
      expect(Code.isValidTask(null, 'hello')).toBe(false);
    });

    it('should return false if messageText is empty', () => {
      expect(Code.isValidTask(new Date(), '')).toBe(false);
      expect(Code.isValidTask(new Date(), null)).toBe(false);
    });
  });



  describe('buildSpeakingMessage', () => {
    it('should format message correctly', () => {
      const time = new Date('2023-10-01T10:05:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('10時5分です。hello');
    });

    it('should format 0 minutes as "ちょうど"', () => {
      const time = new Date('2023-10-01T10:00:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('10時ちょうどです。hello');
    });

    it('should handle 12-hour format correctly', () => {
      expect(Code.buildSpeakingMessage(new Date('2023-10-01T00:00:00'), 'a')).toContain('12時');
      expect(Code.buildSpeakingMessage(new Date('2023-10-01T12:00:00'), 'a')).toContain('12時');
      expect(Code.buildSpeakingMessage(new Date('2023-10-01T13:00:00'), 'a')).toContain('1時');
    });
  });


  describe('callGroq', () => {
    it('should return content from Groq API on success and strip think tags', () => {
      mockGetProperty.mockImplementation(key => {
        if (key === 'GROQ_API_KEY') return 'test-api-key';
        if (key === 'GROQ_MODEL') return null;
        return null;
      });
      const mockResponse = {
        choices: [{ message: { content: '<think>\nReasoning process here...\n</think>\nGroq response' } }]
      };
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify(mockResponse)
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Groq response');
      expect(mockGetProperty).toHaveBeenCalledWith('GROQ_API_KEY');
      expect(mockGetProperty).toHaveBeenCalledWith('GROQ_MODEL');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          method: 'post',
          headers: { Authorization: 'Bearer test-api-key' },
          payload: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'test prompt' }],
            temperature: 0.7
          })
        })
      );
    });

    it('should use custom GROQ_MODEL property if set', () => {
      mockGetProperty.mockImplementation(key => {
        if (key === 'GROQ_API_KEY') return 'test-api-key';
        if (key === 'GROQ_MODEL') return 'llama-3.1-8b-instant';
        return null;
      });
      const mockResponse = {
        choices: [{ message: { content: 'Groq custom model response' } }]
      };
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify(mockResponse)
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Groq custom model response');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          payload: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'test prompt' }],
            temperature: 0.7
          })
        })
      );
    });

    it('should return error message on failure', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? null : 'test-api-key'));
      mockFetch.mockImplementation(() => {
        throw new Error('Fetch failed');
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Error: Error: Fetch failed');
    });

    it('should return error message on invalid JSON response', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? null : 'test-api-key'));
      mockFetch.mockReturnValue({
        getContentText: () => 'invalid json'
      });

      const result = Code.callGroq('test prompt');

      expect(result).toContain('Error: SyntaxError');
    });

    it('should return API error message when Groq API returns an error payload', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? null : 'test-api-key'));
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({
          error: { message: 'Invalid API key or rate limit exceeded' }
        })
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Error: Invalid API key or rate limit exceeded');
    });

    it('should return stringified error object if error message is missing', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? null : 'test-api-key'));
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({
          error: { code: 500 }
        })
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Error: {"code":500}');
    });

    it('should return error message when response format is missing choices', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? null : 'test-api-key'));
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({})
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Error: Invalid response format from Groq API');
    });
    it('should call the groq-gas wrapper when GROQ_GAS_URL is set', () => {
      mockGetProperty.mockImplementation(key => {
        if (key === 'GROQ_GAS_URL') return 'https://example.com/groq-gas/exec';
        return null;
      });
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({ answer: '<think>thinking</think>Rephrased text', cached: false })
      });

      const result = Code.callGroq('test prompt');

      expect(result).toBe('Rephrased text');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/groq-gas/exec',
        expect.objectContaining({
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ p: 'test prompt' })
        })
      );
    });

    it('should return wrapper error message when groq-gas returns an error string', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null));
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({ error: "Parameter 'p' is required." })
      });

      expect(Code.callGroq('test prompt')).toBe("Error: Parameter 'p' is required.");
    });

    it('should stringify a non-string wrapper error', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null));
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({ error: { code: 500 } })
      });

      expect(Code.callGroq('test prompt')).toBe('Error: {"code":500}');
    });

    it('should return error when the wrapper response has no answer', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null));
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({})
      });

      expect(Code.callGroq('test prompt')).toBe('Error: Invalid response format from groq-gas');
    });

    it('should return error message when the wrapper fetch fails', () => {
      mockGetProperty.mockImplementation(key => (key === 'GROQ_GAS_URL' ? 'https://example.com/groq-gas/exec' : null));
      mockFetch.mockImplementation(() => {
        throw new Error('Fetch failed');
      });

      expect(Code.callGroq('test prompt')).toBe('Error: Error: Fetch failed');
    });
  });


  describe('listGroqModels', () => {
    it('should fetch models list and log response content', () => {
      mockGetProperty.mockReturnValue('test-api-key');
      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant' }] })
      });

      const result = Code.listGroqModels();

      expect(result).toBe('{"data":[{"id":"llama-3.1-8b-instant"}]}');
      expect(mockLog).toHaveBeenCalledWith('Available Models: {"data":[{"id":"llama-3.1-8b-instant"}]}');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/models',
        {
          method: 'get',
          headers: { Authorization: 'Bearer test-api-key' },
          muteHttpExceptions: true
        }
      );
    });

    it('should handle and log fetch errors gracefully', () => {
      mockGetProperty.mockReturnValue('test-api-key');
      mockFetch.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = Code.listGroqModels();

      expect(result).toBe('Error: Error: Network error');
      expect(mockLog).toHaveBeenCalledWith('Error: Error: Network error');
    });
  });

  describe('refreshMessageText', () => {
    const mockSetValues = vi.fn();

    beforeEach(() => {
      mockGetDataRange.mockReturnValue({
        getValues: mockGetValues,
        setValues: mockSetValues,
      });
    });

    it('should clean spaces, call callGroq, log rephrased text and preserve other columns', () => {
      const date = new Date();
      mockGetValues.mockReturnValue([
        [date, '  hello  ', 'extra1'],
        [date, '　全角　', 'extra2', 'extra3'],
        [date, 123, 'not a string'],
        [date, '   ', 'only spaces'],
      ]);

      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({
          choices: [{ message: { content: 'rephrased result' } }]
        })
      });

      Code.refreshMessageText();

      expect(mockLog).toHaveBeenCalledWith('hello -> rephrased result');
      expect(mockLog).toHaveBeenCalledWith('全角 -> rephrased result');
      expect(mockLog).toHaveBeenCalledTimes(2);

      expect(mockSetValues).toHaveBeenCalledWith([
        [date, 'rephrased result', 'extra1'],
        [date, 'rephrased result', 'extra2', 'extra3'],
        [date, 123, 'not a string'],
        [date, '   ', 'only spaces'],
      ]);
    });

    it('should not update row if callGroq returns an error message starting with Error:', () => {
      const date = new Date();
      mockGetValues.mockReturnValue([
        [date, '  hello  ', 'extra1'],
      ]);

      mockFetch.mockReturnValue({
        getContentText: () => JSON.stringify({
          error: { message: 'The model llama-3.1-8b-instant does not exist' }
        })
      });

      Code.refreshMessageText();

      expect(mockSetValues).toHaveBeenCalledWith([
        [date, '  hello  ', 'extra1'],
      ]);
    });
  });

  describe('alarm sync helpers', () => {
    it('builds a wire-form speech command from the speaker API URL', () => {
      expect(
        Code.buildSyncSpeechCommand(
          'https://a.ze.gs/google-home-speaker-wrapper/-h/192.168.1.22/-v/60/-s/',
          '7時ちょうどです。朝ごはんです'
        )
      ).toBe(
        'google-home-speaker-wrapper -h 192.168.1.22 -v 60 -s ' +
          encodeURIComponent('7時ちょうどです。朝ごはんです')
      );
      expect(Code.buildSyncSpeechCommand('http://home-api.example/speak/-s/', 'x')).toBe(
        'speak -s ' + encodeURIComponent('x')
      );
    });

    it('derives desired rules from rows, skipping invalid ones', () => {
      const rows = [
        [new Date(2026, 10, 2, 7, 0), '朝ごはんです'],
        [new Date(2026, 10, 2, 7, 30), '　'],
        ['not a date', 'skip'],
        [new Date(2026, 10, 2, 8, 0), ''],
      ];
      const desired = Code.desiredSyncRules(rows, 'http://home-api.example/speak/-s/');
      expect(Object.keys(desired).sort()).toEqual(['07:00', '07:30']);
      expect(desired['07:00'].command).toBe(
        'speak -s ' + encodeURIComponent('7時ちょうどです。朝ごはんです')
      );
      expect(desired['07:30'].command).toBe(
        'speak -s ' + encodeURIComponent('7時30分です。')
      );
    });

    it('plans keeps, recreations, and deletions', () => {
      const desired = {
        '07:00': { command: 'cmd-a' },
        '07:30': { command: 'cmd-b2' },
        '08:00': { command: 'cmd-c' },
      };
      const stored = {
        '07:00': { id: 'r1', command: 'cmd-a' },
        '07:30': { id: 'r2', command: 'cmd-b1' },
        '09:00': { id: 'r3', command: 'cmd-d' },
        '10:00': { id: 'r4', command: 'cmd-e' },
      };
      const current = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
      const plan = Code.planSync(desired, stored, current);
      expect(plan.kept).toEqual({ '07:00': { id: 'r1', command: 'cmd-a' } });
      expect(plan.toDelete.sort()).toEqual(['r2', 'r3']);
      expect(plan.toCreate).toEqual([
        { time: '07:30', command: 'cmd-b2' },
        { time: '08:00', command: 'cmd-c' },
      ]);
    });
  });

  describe('syncTimetableToAlarm', () => {
    const store = {};
    let fetchBodies;

    beforeEach(() => {
      Object.keys(store).forEach((key) => delete store[key]);
      store.ALARM_EXEC_URL = 'https://alarm.example/exec';
      store.ALARM_SYNC_TOKEN = 'sync-token-1';
      fetchBodies = [];
      mockGetScriptProperties.mockReturnValue({
        getProperty: (key) =>
          key === 'SPEAKER_API_URL'
            ? 'http://home-api.example/speak/-s/'
            : store[key] ?? null,
        setProperty: (key, value) => {
          store[key] = value;
        },
      });
      vi.stubGlobal('LockService', {
        getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
      });
      mockFetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.payload);
        fetchBodies.push(body);
        let result;
        if (body.action === 'list_rules') {
          result = { ok: true, rules: [] };
        } else if (body.action === 'set_rule') {
          result = { ok: true, rule: { id: `id-${body.time}` } };
        } else {
          result = { ok: true, deleted: 1 };
        }
        return { getContentText: () => JSON.stringify(result) };
      });
    });

    it('creates a rule per announcement row and saves the map', () => {
      mockGetValues.mockReturnValue([
        [new Date(2026, 10, 2, 7, 0), '朝ごはんです'],
        [new Date(2026, 10, 2, 19, 0), '夕ごはんです'],
      ]);

      Code.syncTimetableToAlarm();

      const sets = fetchBodies.filter((b) => b.action === 'set_rule');
      expect(sets).toHaveLength(2);
      expect(sets[0].time).toBe('07:00');
      expect(sets[0].sync_token).toBe('sync-token-1');
      expect(sets[0].commands[0]).toBe(
        'speak -s ' + encodeURIComponent('7時ちょうどです。朝ごはんです')
      );
      const map = JSON.parse(store.ALARM_SYNC_MAP);
      expect(Object.keys(map).sort()).toEqual(['07:00', '19:00']);
      expect(map['07:00'].id).toBe('id-07:00');
    });

    it('deletes the rule when the text is removed from the sheet', () => {
      store.ALARM_SYNC_MAP = JSON.stringify({
        '07:00': { id: 'r1', command: 'speak -s old' },
      });
      mockGetValues.mockReturnValue([[new Date(2026, 10, 2, 7, 0), '']]);
      mockFetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.payload);
        fetchBodies.push(body);
        const result =
          body.action === 'list_rules'
            ? { ok: true, rules: [{ id: 'r1', time: '07:00', commands: ['speak -s old'] }] }
            : { ok: true, deleted: 1 };
        return { getContentText: () => JSON.stringify(result) };
      });

      Code.syncTimetableToAlarm();

      expect(fetchBodies.filter((b) => b.action === 'delete_rule')).toEqual([
        expect.objectContaining({ id: 'r1' }),
      ]);
      expect(JSON.parse(store.ALARM_SYNC_MAP)).toEqual({});
    });
  });
});
