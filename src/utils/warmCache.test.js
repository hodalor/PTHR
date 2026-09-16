import {
  SESSION_WARM_CACHE_PREFIX,
  buildWarmCacheStorageKey,
  readWarmCache,
  writeWarmCache,
} from './warmCache';

describe('warmCache', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('builds scoped storage keys', () => {
    expect(buildWarmCacheStorageKey('dashboard::tenant-a')).toBe(
      `${SESSION_WARM_CACHE_PREFIX}:dashboard::tenant-a`
    );
  });

  test('writes and reads successful cache payloads', () => {
    writeWarmCache('employees', { records: [{ id: 1 }] }, 5000);

    expect(readWarmCache('employees')).toEqual(
      expect.objectContaining({
        payload: { records: [{ id: 1 }] },
      })
    );
  });

  test('returns null and clears expired cache entries', () => {
    const setItemSpy = jest.spyOn(window.sessionStorage.__proto__, 'setItem');
    writeWarmCache('attendance', { records: [] }, -1000);

    expect(setItemSpy).toHaveBeenCalled();
    expect(readWarmCache('attendance')).toBeNull();
    expect(window.sessionStorage.getItem(buildWarmCacheStorageKey('attendance'))).toBeNull();
  });

  test('returns null for invalid cached JSON', () => {
    window.sessionStorage.setItem(buildWarmCacheStorageKey('broken'), '{bad-json');

    expect(readWarmCache('broken')).toBeNull();
  });

  test('tolerates storage write failures without throwing', () => {
    jest.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => writeWarmCache('quota-test', { ok: true })).not.toThrow();
  });
});
