/**
 * @test download-skill
 * @intent Verify downloadFromGitHub/downloadTarball/downloadWithRetry/downloadFile/verifyChecksum behaviors
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Writable } = require('stream');

/**
 * Mock https.get with controllable behavior.
 * opts (or array of opts for sequential calls):
 *   - statusCode (default 200)
 *   - body (default 'data')
 *   - errorAfter (boolean) — emit 'error' on the request instead of responding
 *   - redirectTo (string url) — sends 302 with location header
 */
function mockHttpsGet(optsOrList) {
  const list = Array.isArray(optsOrList) ? [...optsOrList] : [optsOrList];
  // Synchronous fake createWriteStream — the real one opens the FD asynchronously
  // and races against downloadFile's unlinkSync(dest) in 301/302/error branches,
  // causing ENOENT unhandled errors. The fake writes via writeFileSync (sync,
  // file present immediately) and emits 'finish' on end().
  vi.spyOn(fs, 'createWriteStream').mockImplementation((dest) => {
    let buf = '';
    try {
      fs.writeFileSync(dest, '');
    } catch {
      /* dest dir may not exist; downstream code will surface that */
    }
    const stream = new EventEmitter();
    stream.write = (chunk) => {
      buf += chunk;
      return true;
    };
    stream.end = () => {
      try {
        fs.writeFileSync(dest, buf);
      } catch {
        /* file may have been unlinked by source; safe to ignore */
      }
      process.nextTick(() => stream.emit('finish'));
    };
    stream.close = () => {};
    return stream;
  });

  vi.spyOn(https, 'get').mockImplementation((url, options, cb) => {
    const callback = typeof options === 'function' ? options : cb;
    const req = new EventEmitter();
    const config = list.shift() || { statusCode: 200, body: 'data' };
    process.nextTick(() => {
      if (config.errorAfter) {
        req.emit('error', new Error('Network error'));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = config.statusCode != null ? config.statusCode : 200;
      response.headers = config.redirectTo ? { location: config.redirectTo } : {};
      response.pipe = (file) => {
        file.write(config.body != null ? config.body : 'data');
        file.end();
      };
      callback(response);
    });
    return req;
  });
}

describe('download-skill', () => {
  let tmpHome, originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-dl-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../download-skill')];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
    if (fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  function cacheDir() {
    return path.join(tmpHome, '.config', 'xp-gate', 'cache');
  }

  describe('downloadFromGitHub', () => {
    // Flat repo name avoids '/' becoming a subdir in cacheFile (source only mkdirs CACHE_DIR root).
    it('downloads file to cache dir and returns the path', async () => {
      mockHttpsGet({ statusCode: 200, body: '# Skill content' });
      const { downloadFromGitHub } = require('../download-skill');

      const result = await downloadFromGitHub('flatrepo', 'skills/foo/SKILL.md');

      expect(result).toBe(
        path.join(cacheDir(), 'flatrepo-skills-foo-SKILL.md.md')
      );
      expect(fs.existsSync(result)).toBe(true);
      expect(fs.readFileSync(result, 'utf8')).toBe('# Skill content');
    });

    it('creates cache directory if missing', async () => {
      mockHttpsGet({ statusCode: 200, body: 'data' });
      const { downloadFromGitHub } = require('../download-skill');

      expect(fs.existsSync(cacheDir())).toBe(false);
      await downloadFromGitHub('flatrepo', 'a/b');
      expect(fs.existsSync(cacheDir())).toBe(true);
    });

    it('uses default version=main when not specified', async () => {
      mockHttpsGet({ statusCode: 200, body: 'data' });
      const { downloadFromGitHub } = require('../download-skill');
      await downloadFromGitHub('flatrepo', 'path/to/file');
      expect(https.get).toHaveBeenCalled();
      const calledUrl = https.get.mock.calls[0][0];
      expect(calledUrl).toContain('/main/');
    });

    it('uses custom version when specified', async () => {
      mockHttpsGet({ statusCode: 200, body: 'data' });
      const { downloadFromGitHub } = require('../download-skill');
      await downloadFromGitHub('flatrepo', 'path/file', 'v1.2.3');
      expect(https.get.mock.calls[0][0]).toContain('/v1.2.3/');
    });
  });

  describe('downloadTarball', () => {
    it('downloads tarball with correct filename', async () => {
      mockHttpsGet({ statusCode: 200, body: 'tarball-bytes' });
      const { downloadTarball } = require('../download-skill');

      const result = await downloadTarball('boyingliu01/xp-gate');

      expect(result).toBe(path.join(cacheDir(), 'boyingliu01-xp-gate.tgz'));
      expect(fs.existsSync(result)).toBe(true);
    });

    it('uses default main version', async () => {
      mockHttpsGet({ statusCode: 200, body: 'data' });
      const { downloadTarball } = require('../download-skill');
      await downloadTarball('user/repo');
      expect(https.get.mock.calls[0][0]).toContain('/tarball/main');
    });
  });

  describe('downloadWithRetry', () => {
    it('succeeds on first try when no errors', async () => {
      mockHttpsGet({ statusCode: 200, body: 'ok' });
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, 'out.txt');
      await downloadWithRetry('https://example.com/x', dest, 3);

      expect(https.get).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(dest, 'utf8')).toBe('ok');
    });

    it('retries and eventually succeeds (sleep delays stubbed)', async () => {
      // Stub setTimeout so sleep() resolves immediately, without patching setImmediate.
      vi.spyOn(global, 'setTimeout').mockImplementation((fn) => {
        Promise.resolve().then(fn);
        return 0;
      });
      mockHttpsGet([
        { errorAfter: true },
        { statusCode: 200, body: 'recovered' },
      ]);
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, 'retry.txt');
      await downloadWithRetry('https://example.com/x', dest, 3);

      expect(fs.readFileSync(dest, 'utf8')).toBe('recovered');
    });

    it('throws original error after exhausting retries', async () => {
      vi.spyOn(global, 'setTimeout').mockImplementation((fn) => {
        Promise.resolve().then(fn);
        return 0;
      });
      mockHttpsGet([
        { errorAfter: true },
        { errorAfter: true },
      ]);
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, 'fail.txt');
      await expect(
        downloadWithRetry('https://example.com/x', dest, 2)
      ).rejects.toThrow('Network error');
    });
  });

  describe('downloadFile (via downloadWithRetry retries=1)', () => {
    it('follows 302 redirect to new location', async () => {
      mockHttpsGet([
        { statusCode: 302, redirectTo: 'https://newlocation.example.com/final' },
        { statusCode: 200, body: 'redirected-content' },
      ]);
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, 'redirect.txt');
      await downloadWithRetry('https://example.com/orig', dest, 1);

      expect(fs.readFileSync(dest, 'utf8')).toBe('redirected-content');
    });

    it('follows 301 redirect', async () => {
      mockHttpsGet([
        { statusCode: 301, redirectTo: 'https://newloc.example/final' },
        { statusCode: 200, body: 'permanent-redirect' },
      ]);
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, 'r301.txt');
      await downloadWithRetry('https://example.com/orig', dest, 1);

      expect(fs.readFileSync(dest, 'utf8')).toBe('permanent-redirect');
    });

    it('rejects with HTTP error for non-2xx/3xx status', async () => {
      mockHttpsGet({ statusCode: 404 });
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, '404.txt');
      await expect(downloadWithRetry('https://example.com/x', dest, 1)).rejects.toThrow(
        'HTTP 404'
      );
    });

    it('rejects and unlinks dest on request error', async () => {
      mockHttpsGet({ errorAfter: true });
      const { downloadWithRetry } = require('../download-skill');

      const dest = path.join(tmpHome, 'err.txt');
      await expect(downloadWithRetry('https://example.com/x', dest, 1)).rejects.toThrow(
        'Network error'
      );
      // The createWriteStream call will create the file, the error handler should unlink it
      expect(fs.existsSync(dest)).toBe(false);
    });
  });

  describe('verifyChecksum', () => {
    it('does not throw when checksum matches', () => {
      const file = path.join(tmpHome, 'data.txt');
      const content = 'hello world';
      fs.writeFileSync(file, content);
      const expected = crypto.createHash('sha256').update(content).digest('hex');

      const { verifyChecksum } = require('../download-skill');
      expect(() => verifyChecksum(file, expected)).not.toThrow();
      // File preserved
      expect(fs.existsSync(file)).toBe(true);
    });

    it('throws and deletes file on mismatch', () => {
      const file = path.join(tmpHome, 'bad.txt');
      fs.writeFileSync(file, 'real-content');

      const { verifyChecksum } = require('../download-skill');
      expect(() => verifyChecksum(file, 'wrong-hash-zzz')).toThrow(/Checksum mismatch/);
      expect(fs.existsSync(file)).toBe(false);
    });
  });
});
