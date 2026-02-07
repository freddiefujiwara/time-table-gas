import { describe, it, expect, vi, beforeEach } from 'vitest';
import { myFunction, API_URL } from '../src/Code.js';

describe('myFunction', () => {
  const mockGetActiveSheet = vi.fn();
  const mockGetDataRange = vi.fn();
  const mockGetValues = vi.fn();
  const mockFetch = vi.fn();
  const mockLog = vi.fn();

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
  });

  it('should skip rows with invalid data', () => {
    const now = new Date('2023-10-01T10:00:00');
    vi.setSystemTime(now);

    mockGetValues.mockReturnValue([
      ['not a date', 'message'], // Invalid date
      [new Date('2023-10-01T10:00:00'), ''], // Empty text
      [null, 'message'], // Null date
    ]);

    myFunction();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should skip rows where time is outside threshold', () => {
    const now = new Date('2023-10-01T10:00:00');
    vi.setSystemTime(now);

    const farTime = new Date('2023-10-01T10:01:00'); // 60 seconds diff > 35s

    mockGetValues.mockReturnValue([
      [farTime, 'too far'],
    ]);

    myFunction();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should call fetch when time is within threshold (minutes case)', () => {
    const now = new Date('2023-10-01T10:05:00');
    vi.setSystemTime(now);

    const sheetTime = new Date('2023-10-01T10:05:10'); // 10 seconds diff < 35s
    const text = 'hello';

    mockGetValues.mockReturnValue([
      [sheetTime, text],
    ]);
    mockFetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => 'OK',
    });

    myFunction();

    const expectedMessage = `10時5分です。${text}`;
    const expectedUrl = API_URL + encodeURIComponent(expectedMessage);

    expect(mockFetch).toHaveBeenCalledWith(expectedUrl, {
      method: 'get',
      muteHttpExceptions: true,
    });
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining(expectedMessage));
  });

  it('should use "ちょうど" when minutes is 0', () => {
    const now = new Date('2023-10-01T10:00:00');
    vi.setSystemTime(now);

    mockGetValues.mockReturnValue([
      [new Date('2023-10-01T10:00:00'), 'test'],
    ]);
    mockFetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => 'OK',
    });

    myFunction();

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('10時ちょうどです。test')), expect.anything());
  });

  it('should handle 12-hour format (0 hour -> 12)', () => {
    const now = new Date('2023-10-01T00:00:00');
    vi.setSystemTime(now);

    mockGetValues.mockReturnValue([
      [new Date('2023-10-01T00:00:00'), 'midnight'],
    ]);
    mockFetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => 'OK',
    });

    myFunction();

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('12時ちょうどです。midnight')), expect.anything());
  });

  it('should handle 12-hour format (12 hour -> 12)', () => {
    const now = new Date('2023-10-01T12:00:00');
    vi.setSystemTime(now);

    mockGetValues.mockReturnValue([
      [new Date('2023-10-01T12:00:00'), 'noon'],
    ]);
    mockFetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => 'OK',
    });

    myFunction();

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('12時ちょうどです。noon')), expect.anything());
  });

  it('should handle 12-hour format (13 hour -> 1)', () => {
    const now = new Date('2023-10-01T13:00:00');
    vi.setSystemTime(now);

    mockGetValues.mockReturnValue([
      [new Date('2023-10-01T13:00:00'), 'afternoon'],
    ]);
    mockFetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => 'OK',
    });

    myFunction();

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('1時ちょうどです。afternoon')), expect.anything());
  });
});
