import { describe, it, expect, afterEach } from 'bun:test';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	getCachedUpdateInfo,
	shouldCheck,
	buildNotice,
} from '../../src/update-check.js';

describe('update-check', () => {
	describe('shouldCheck', () => {
		it('returns true when cache is null', () => {
			expect(shouldCheck(null)).toBe(true);
		});

		it('returns true when lastCheckedAt is older than 24 hours', () => {
			const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			expect(shouldCheck({ latestVersion: '1.0.0', lastCheckedAt: old })).toBe(true);
		});

		it('returns false when lastCheckedAt is within 24 hours', () => {
			const recent = new Date().toISOString();
			expect(shouldCheck({ latestVersion: '1.0.0', lastCheckedAt: recent })).toBe(false);
		});
	});

	describe('buildNotice', () => {
		it('returns a notice string when latest > current', () => {
			const notice = buildNotice('2.10.0', '2.11.0');
			expect(notice).toContain('2.10.0');
			expect(notice).toContain('2.11.0');
			expect(notice).toContain('agentv self update');
		});

		it('returns null when versions are equal', () => {
			expect(buildNotice('2.10.0', '2.10.0')).toBeNull();
		});

		it('returns null when current > latest', () => {
			expect(buildNotice('2.11.0', '2.10.0')).toBeNull();
		});

		it('returns null when latest is null', () => {
			expect(buildNotice('2.10.0', null)).toBeNull();
		});
	});

	describe('getCachedUpdateInfo', () => {
		const tmpPath = join(tmpdir(), `update-check-test-${process.pid}.json`);

		afterEach(async () => {
			try {
				await unlink(tmpPath);
			} catch {}
		});

		it('returns null for a nonexistent file', async () => {
			const result = await getCachedUpdateInfo('/tmp/does-not-exist.json');
			expect(result).toBeNull();
		});

		it('reads back a valid JSON cache file', async () => {
			const cache = { latestVersion: '1.2.3', lastCheckedAt: '2025-01-01T00:00:00.000Z' };
			await writeFile(tmpPath, JSON.stringify(cache));
			const result = await getCachedUpdateInfo(tmpPath);
			expect(result).toEqual(cache);
		});

		it('returns null for malformed JSON', async () => {
			await writeFile(tmpPath, '{not valid json!!!');
			const result = await getCachedUpdateInfo(tmpPath);
			expect(result).toBeNull();
		});
	});
});
