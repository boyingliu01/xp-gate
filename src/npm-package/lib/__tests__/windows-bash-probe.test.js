/**
 * @test REQ-windows-bash probe behavior
 * @intent resolveWindowsBashCandidates must accept only a bash that round-trips
 *         `-c` positional argv AND reports MINGW/MSYS/CYGWIN via uname — the WSL
 *         System32 stub (Linux uname, dropped $1) is rejected even when PATH
 *         leads with it. Behavior is exercised through an injected fake spawner,
 *         so no real interpreter configuration is assumed on the host (#469
 *         follow-up, Delphi walkthrough R1 MN-06).
 * @covers AC-WINBASH-01, AC-WINBASH-02
 */
const { describe, it, expect } = await import('vitest');
const { resolveWindowsBashCandidates } = require('../detect-deps.js');

// The candidate loop reads `where bash` from the host; tests inject both the
// discovery runner and the probe spawner, so results are deterministic on any
// machine regardless of what interpreter configuration it happens to have.
function fakeWhere(whereOutput) {
  return (cmd) => {
    if (/^where bash/.test(cmd)) {
      if (whereOutput instanceof Error) throw whereOutput;
      return whereOutput || '';
    }
    throw new Error(`unexpected execSync: ${cmd}`);
  };
}

function fakeSpawn(behaviors) {
  const probed = [];
  const fn = (candidate) => {
    probed.push(candidate);
    const b = behaviors[candidate];
    if (b instanceof Error) throw b;
    // Unknown candidates model a missing file: no stdout at all.
    return { stdout: b !== undefined ? b : '' };
  };
  fn.probed = probed;
  return fn;
}

describe('resolveWindowsBashCandidates (win32 authoritative bash)', () => {
  it('AC-WINBASH-01: rejects a WSL stub whose $1 is empty and uname is Linux', () => {
    // The resolver must find nothing rather than settle for the stub — and on
    // current Windows the System32 stub is skipped by name without even being
    // spawned (cold-launch stall); this world uses a non-System32 stub to keep
    // testing the output-based rejection path itself.
    const spawn = fakeSpawn({ 'C:\\wsl-stub\\bash.exe': '[ ]\nLinux\n' });
    expect(resolveWindowsBashCandidates(spawn, fakeWhere('C:\\wsl-stub\\bash.exe\r\n'))).toBeNull();
  });

  it('AC-WINBASH-01: accepts the first candidate with argv round-trip + MINGW uname', () => {
    const spawn = fakeSpawn({
      'C:\\a\\bash.exe': '[]\nLinux\n', // drops $1 → reject
      'C:\\b\\bash.exe': '[XPGATE_ARGV_PROBE]\nMINGW64_NT-10.0\n', // accept
    });
    const result = resolveWindowsBashCandidates(spawn, fakeWhere('C:\\a\\bash.exe\r\nC:\\b\\bash.exe\r\n'));
    expect(result).toBe('C:\\b\\bash.exe');
    // Known Git paths are probed BEFORE PATH discoveries (cold WSL launches
    // stall the event loop for seconds), so a/b keep their relative order but
    // trail the hardcoded fallbacks.
    expect(spawn.probed.slice(-2)).toEqual(['C:\\a\\bash.exe', 'C:\\b\\bash.exe']);
  });

  it('AC-WINBASH-02: probes known Git paths before PATH discoveries', () => {
    // Regression for the doctor fan-out starvation: System32\bash.exe leads
    // `where bash` on WSL machines and its cold launch blocks ~3.4s. It must
    // never be spawned at all — neither from where-output nor as any fallback.
    const spawn = fakeSpawn({
      'C:\\Program Files\\Git\\bin\\bash.exe': '[XPGATE_ARGV_PROBE]\nMSYS_NT-10.0\n',
    });
    const { result } = (() => ({
      result: resolveWindowsBashCandidates(spawn, fakeWhere('C:\\Windows\\System32\\bash.exe\r\n')),
    }))();
    expect(result).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(spawn.probed).not.toContain('C:\\Windows\\System32\\bash.exe');
  });

  it('AC-WINBASH-01: a Linux uname with intact argv still fails the platform test', () => {
    // A real WSL bash answers [XPGATE_ARGV_PROBE] correctly under some
    // invocations but its filesystem view cannot run these hooks — uname wins.
    const spawn = fakeSpawn({ 'C:\\wsl\\bash.exe': '[XPGATE_ARGV_PROBE]\nLinux\n' });
    expect(resolveWindowsBashCandidates(spawn, fakeWhere('C:\\wsl\\bash.exe\r\n'))).toBeNull();
  });

  it('AC-WINBASH-01: a throwing candidate is skipped, not fatal', () => {
    const spawn = fakeSpawn({
      'C:\\gone\\bash.exe': new Error('ENOENT'),
      'C:\\msys64\\usr\\bin\\bash.exe': '[XPGATE_ARGV_PROBE]\nMSYS_NT-10.0\n',
    });
    const result = resolveWindowsBashCandidates(spawn, fakeWhere(new Error('where unavailable')));
    expect(result).toBe('C:\\msys64\\usr\\bin\\bash.exe');
  });

  it('AC-WINBASH-02: WSL stubs are skipped by name regardless of separators or case', () => {
    // The filter normalizes slashes and ignores case/drive: forward-slash and
    // lowercase variants of the same stub must still produce NO spawn call.
    // The AppX alias lives under <Windows>\SystemApps\Microsoft.WSL_* — a
    // user's own install merely NAMED ...\WindowsApps\... is NOT the stub and
    // must still be probed (output-based rejection covers it).
    const spawn = fakeSpawn({});
    resolveWindowsBashCandidates(spawn, fakeWhere(
      'c:/windows/sysnative/bash.exe\r\nC:\\WINDOWS\\System32\\bash.exe\r\nC:\\Windows\\SysWOW64\\bash.exe\r\nC:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe\r\n'
    ));
    expect(spawn.probed.filter(p => /system32|sysnative|syswow64|appdata\\local\\microsoft\\windowsapps/i.test(p.replace(/\//g, '\\')))).toEqual([]);
    const userOwned = fakeSpawn({});
    resolveWindowsBashCandidates(userOwned, fakeWhere('D:\\Tools\\WindowsApps\\bash.exe\r\n'));
    expect(userOwned.probed).toContain('D:\\Tools\\WindowsApps\\bash.exe');
  });
});
