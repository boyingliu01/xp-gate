/**
 * @test REQ-windows-bash probe behavior
 * @intent resolveWindowsBashCandidates must accept only a bash that round-trips
 *         `-c` positional argv AND reports MINGW/MSYS/CYGWIN via uname — the WSL
 *         System32 stub (Linux uname, dropped $1) is rejected even when PATH
 *         leads with it. Behavior is exercised through an injected fake spawner,
 *         so no real interpreter configuration is assumed on the host (#469
 *         follow-up, Delphi walkthrough R1 MN-06).
 * @covers AC-WINBASH-01
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
    const spawn = fakeSpawn({ 'C:\\Windows\\System32\\bash.exe': '[ ]\nLinux\n' });
    // No MSYS candidate exists in this world (hardcoded fallbacks report no
    // stdout), so the resolver must find nothing rather than settle for the stub.
    expect(resolveWindowsBashCandidates(spawn, fakeWhere('C:\\Windows\\System32\\bash.exe\r\n'))).toBeNull();
  });

  it('AC-WINBASH-01: accepts the first candidate with argv round-trip + MINGW uname', () => {
    const spawn = fakeSpawn({
      'C:\\a\\bash.exe': '[]\nLinux\n', // drops $1 → reject
      'C:\\b\\bash.exe': '[XPGATE_ARGV_PROBE]\nMINGW64_NT-10.0\n', // accept
    });
    const result = resolveWindowsBashCandidates(spawn, fakeWhere('C:\\a\\bash.exe\r\nC:\\b\\bash.exe\r\n'));
    expect(result).toBe('C:\\b\\bash.exe');
    expect(spawn.probed.slice(0, 2)).toEqual(['C:\\a\\bash.exe', 'C:\\b\\bash.exe']);
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
});
