import { describe, expect, it } from 'vitest';
import { buildGroupJoinLink, parseGroupJoinParams, SUPPORTED_GROUP_JOIN_SOURCES } from '../src/ui/groupJoinLinkParser.js';

function paramsFrom(query) {
  return new URLSearchParams(query);
}

describe('parseGroupJoinParams', () => {
  it('returns null when no group-join params are present at all (normal boot, not a shared link)', () => {
    expect(parseGroupJoinParams(paramsFrom(''))).toBeNull();
  });

  it('parses a valid TD (TrainerDay) group-join link', () => {
    const result = parseGroupJoinParams(
      paramsFrom('source=TD&source_url=' + encodeURIComponent('https://app.trainerday.com/workouts/abc') + '&startTime=202607242000')
    );
    expect(result.source).toBe('TD');
    expect(result.sourceUrl).toBe('https://app.trainerday.com/workouts/abc');
    expect(result.startTime.getFullYear()).toBe(2026);
    expect(result.startTime.getMonth()).toBe(6);
    expect(result.startTime.getDate()).toBe(24);
    expect(result.startTime.getHours()).toBe(20);
    expect(result.startTime.getMinutes()).toBe(0);
  });

  it('throws a clear error for an unsupported source value, without silently misinterpreting it', () => {
    expect(() =>
      parseGroupJoinParams(paramsFrom('source=TP&source_url=https%3A%2F%2Fexample.com&startTime=202607242000'))
    ).toThrow(/課表來源「TP」目前不支援/);
  });

  it('throws a clear error when source is present but the other two params are missing', () => {
    expect(() => parseGroupJoinParams(paramsFrom('source=TD'))).toThrow(/缺少 source_url/);
  });

  it('throws a clear error when source_url is missing', () => {
    expect(() => parseGroupJoinParams(paramsFrom('source=TD&startTime=202607242000'))).toThrow(/缺少 source_url/);
  });

  it('throws a clear error when startTime is missing', () => {
    expect(() =>
      parseGroupJoinParams(paramsFrom('source=TD&source_url=' + encodeURIComponent('https://app.trainerday.com/workouts/abc')))
    ).toThrow(/缺少 startTime/);
  });

  it('throws a clear error when source_url is not a valid URL at all (e.g. not properly encoded, breaking the query string)', () => {
    // an un-encoded "&" in source_url would have split the query string, so what actually
    // arrives here as source_url is just a URL-fragment - not parseable as a URL
    expect(() => parseGroupJoinParams(paramsFrom('source=TD&source_url=not a url&startTime=202607242000'))).toThrow(
      /source_url 課表網址格式錯誤/
    );
  });

  it('throws a clear error when source_url is a non-http(s) protocol', () => {
    expect(() =>
      parseGroupJoinParams(paramsFrom('source=TD&source_url=' + encodeURIComponent('file:///etc/passwd') + '&startTime=202607242000'))
    ).toThrow(/source_url 課表網址格式錯誤/);
  });

  it('throws a clear error when source_url does not point at TrainerDay for source=TD', () => {
    expect(() =>
      parseGroupJoinParams(paramsFrom('source=TD&source_url=' + encodeURIComponent('https://example.com/workouts/abc') + '&startTime=202607242000'))
    ).toThrow(/不是 TrainerDay 課表網址/);
  });

  it('throws a clear error when startTime has the wrong format (reuses scheduledStartTimeParser\'s message)', () => {
    expect(() =>
      parseGroupJoinParams(
        paramsFrom('source=TD&source_url=' + encodeURIComponent('https://app.trainerday.com/workouts/abc') + '&startTime=2026-07-24 20:00')
      )
    ).toThrow(/startTime 開始時間格式錯誤/);
  });

  it('SUPPORTED_GROUP_JOIN_SOURCES currently lists only TD', () => {
    expect(Object.keys(SUPPORTED_GROUP_JOIN_SOURCES)).toEqual(['TD']);
  });
});

describe('buildGroupJoinLink', () => {
  const BASE_URL = 'https://cycling-workout-countdown.vercel.app/';

  it('builds a correctly-encoded share link from a plain TrainerDay URL and start time', () => {
    const link = buildGroupJoinLink(BASE_URL, {
      sourceUrl: 'https://app.trainerday.com/workouts/2026-ftp-test?ref=abc',
      startTimeText: '202607242000',
    });

    const url = new URL(link);
    expect(url.origin + url.pathname).toBe(BASE_URL);
    expect(url.searchParams.get('source')).toBe('TD');
    expect(url.searchParams.get('source_url')).toBe('https://app.trainerday.com/workouts/2026-ftp-test?ref=abc');
    expect(url.searchParams.get('startTime')).toBe('202607242000');
    // the raw query string itself must have the special characters percent-encoded
    expect(link).toContain('source_url=https%3A%2F%2Fapp.trainerday.com');
  });

  it('the generated link round-trips through parseGroupJoinParams back to the same values', () => {
    const link = buildGroupJoinLink(BASE_URL, {
      sourceUrl: 'https://app.trainerday.com/workouts/abc?x=1&y=2',
      startTimeText: '202607242000',
    });

    const url = new URL(link);
    const parsed = parseGroupJoinParams(url.searchParams);
    expect(parsed.sourceUrl).toBe('https://app.trainerday.com/workouts/abc?x=1&y=2');
    expect(parsed.startTime.getHours()).toBe(20);
  });

  it('throws when the workout URL is blank', () => {
    expect(() => buildGroupJoinLink(BASE_URL, { sourceUrl: '  ', startTimeText: '202607242000' })).toThrow(/請輸入課表網址/);
  });

  it('throws when the workout URL is not a valid TrainerDay URL', () => {
    expect(() => buildGroupJoinLink(BASE_URL, { sourceUrl: 'https://example.com/abc', startTimeText: '202607242000' })).toThrow(
      /只支援 TrainerDay/
    );
  });

  it('throws when the start time has an invalid format', () => {
    expect(() =>
      buildGroupJoinLink(BASE_URL, { sourceUrl: 'https://app.trainerday.com/workouts/abc', startTimeText: '2026-07-24 20:00' })
    ).toThrow(/日期時間格式錯誤/);
  });
});
