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

  describe('myFunction and processScheduledTasks', () => {
    it('should call processScheduledTasks through myFunction', () => {
      // We can't easily mock exported functions in the same module when they call each other directly
      // but we can verify the end-to-end behavior.
      const now = new Date('2023-10-01T10:00:00');
      vi.setSystemTime(now);
      mockGetValues.mockReturnValue([[now, 'test']]);
      mockFetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () => 'OK',
      });

      Code.myFunction();

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should process multiple valid rows within threshold', () => {
      const now = new Date('2023-10-01T10:00:00');
      vi.setSystemTime(now);

      mockGetValues.mockReturnValue([
        [new Date('2023-10-01T10:00:00'), 'msg1'],
        [new Date('2023-10-01T10:00:10'), 'msg2'],
      ]);
      mockFetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () => 'OK',
      });

      Code.processScheduledTasks();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockLog).toHaveBeenCalledTimes(2);
    });

    it('should skip invalid or out-of-threshold tasks', () => {
      const now = new Date('2023-10-01T10:00:00');
      vi.setSystemTime(now);

      mockGetValues.mockReturnValue([
        ['not a date', 'msg1'], // invalid task
        [new Date('2023-10-01T10:01:00'), 'msg2'], // out of threshold
      ]);

      Code.processScheduledTasks();

      expect(mockFetch).not.toHaveBeenCalled();
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

  describe('getTargetTimeToday', () => {
    it('should return a date with today\'s year/month/day and scheduled hour/min/sec', () => {
      const now = new Date('2023-12-25T10:00:00');
      const scheduled = new Date('2000-01-01T15:30:45');
      const result = Code.getTargetTimeToday(now, scheduled);

      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(11); // December is 11
      expect(result.getDate()).toBe(25);
      expect(result.getHours()).toBe(15);
      expect(result.getMinutes()).toBe(30);
      expect(result.getSeconds()).toBe(45);
      expect(result.getMilliseconds()).toBe(0);
    });
  });

  describe('isTimeWithinThreshold', () => {
    const threshold = 35000;

    it('should return true if difference is within threshold', () => {
      const now = new Date(100000);
      const target = new Date(135000);
      expect(Code.isTimeWithinThreshold(now, target, threshold)).toBe(true);
    });

    it('should return true if difference is exactly the threshold', () => {
      const now = new Date(100000);
      const target = new Date(135000);
      expect(Code.isTimeWithinThreshold(now, target, 35000)).toBe(true);
    });

    it('should return false if difference exceeds threshold', () => {
      const now = new Date(100000);
      const target = new Date(135001);
      expect(Code.isTimeWithinThreshold(now, target, threshold)).toBe(false);
    });

    it('should handle negative difference (target before now)', () => {
      const now = new Date(100000);
      const target = new Date(65000);
      expect(Code.isTimeWithinThreshold(now, target, threshold)).toBe(true);
    });
  });

  describe('buildSpeakingMessage', () => {
    it('should format 0 minutes as "ちょうど"', () => {
      const time = new Date('2023-10-01T10:00:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('10時ちょうどです。hello');
    });

    it('should format non-zero minutes correctly', () => {
      const time = new Date('2023-10-01T10:05:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('10時5分です。hello');
    });

    it('should convert 0 hour to 12', () => {
      const time = new Date('2023-10-01T00:00:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('12時ちょうどです。hello');
    });

    it('should convert 12 hour to 12', () => {
      const time = new Date('2023-10-01T12:00:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('12時ちょうどです。hello');
    });

    it('should convert 13 hour to 1', () => {
      const time = new Date('2023-10-01T13:00:00');
      expect(Code.buildSpeakingMessage(time, 'hello')).toBe('1時ちょうどです。hello');
    });
  });

  describe('callSpeakerApi', () => {
    it('should call fetch with correct URL and options', () => {
      mockFetch.mockReturnValue({ response: 'ok' });
      const message = 'テストメッセージ';
      Code.callSpeakerApi(message);

      const expectedUrl = Code.API_URL + encodeURIComponent(message);
      expect(mockFetch).toHaveBeenCalledWith(expectedUrl, {
        method: 'get',
        muteHttpExceptions: true,
      });
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

    it('should clean spaces and log/update non-empty messages', () => {
      const date = new Date();
      mockGetValues.mockReturnValue([
        [date, '  hello  world  '],
        [date, '　全角　スペース　'],
        [date, '   '],
        [date, ''],
        [date, 123],
      ]);

      Code.refreshMessageText();

      expect(mockLog).toHaveBeenCalledWith('helloworld');
      expect(mockLog).toHaveBeenCalledWith('全角スペース');
      expect(mockLog).toHaveBeenCalledTimes(2);

      expect(mockSetValues).toHaveBeenCalledWith([
        [date, 'helloworld'],
        [date, '全角スペース'],
        [date, '   '],
        [date, ''],
        [date, 123],
      ]);
    });
  });
});
