#!/usr/bin/env bats
# @test REQ-FIXTURE-ISOLATION
# @intent Measured on the project repo while committing through the real hook:
#         four files appeared at the repo ROOT -- `a.py` (three copies of the
#         same `def f(): return 1` fixture), `a.rb`, `main.go`, `go.mod`. Their
#         content is copied verbatim from suites in this directory whose
#         fixtures DO `cd "$FIXTURE"` first, so that `cd` was not honoured for
#         those writes in at least one execution: the fixtures were one failed
#         `cd` away from writing into the repository the hook was committing,
#         and a fixture that then runs `git add -A` stages them into someone
#         else's commit.
#
#         The QA gate is the per-test `cd` discipline, because that is what
#         decides where a bare `> a.py` lands: bats runs every `@test` in a fresh
#         process rooted at the repo root, and bash does not undo a child's
#         `cd`. A test that writes before isolating itself therefore writes into
#         whatever tree the hook is committing -- no matter how careful the
#         tests around it are, and an `|| exit 1` inside a helper is invisible
#         from the test body.
#
#         Contract: a write of a source-extension file inside a `setup()` or
#         `@test` body, or inside a helper one of them calls, is a finding when
#         the block has not entered a directory by then. Entering means a `cd`
#         the block kept (setup's `cd` counts for the tests that follow), a
#         `cd` on the same line before the write, a `mkdir` of a directory the
#         write is under, or a call to a helper that leaves its caller in one.
#         `cd /`, `cd ..` and `cd "$BATS_TEST_DIRNAME"` return to the repo root;
#         `( cd X && ... )` moves nothing outside the group; a `git init` in a
#         helper moves the helper, not the test that calls it.
# @covers AC-FIXTURE-ISOLATION-01
# @covers AC-FIXTURE-ISOLATION-02
# @covers AC-FIXTURE-ISOLATION-03
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HELPER_DIR="$(mktemp -d)"
  cat > "$HELPER_DIR/scan.py" <<'SCAN'
import re, sys

# One model, no control-flow heuristics:
#
#   * A BLOCK is a setup()/setup_file() body, a @test body, or a helper body.
#     It ends only on a line that is exactly `}`; a line inside it that opens a
#     here-document keeps its payload out of the block's shell.
#   * A `cd` moves the shell and holds for the rest of the block, and a call to
#     a helper that cds moves it the same way; `git init` in a helper moves
#     the helper only, and a child (`run`, `bash -c`) moves nothing in the
#     parent.
#   * `mkdir` makes a directory, which covers the paths under it for the rest
#     of the block. A line that moves the block after it wrote on that line
#     still moves the lines below: the write is judged where the line found
#     the shell.
#   * A helper is judged as a whole, by what it leaves its caller: a cd that
#     carries to its end, or a write it makes inside a directory it made. Its
#     own bare writes are not findings by themselves.
#   * A test body starts where the block before it left the shell: an @test is
#     named '' here, and setup()'s ending state carries into every test, because
#     bats runs them all after that one setup.
#   * Only "writing at the repo root" is a finding, and only for source
#     extensions. A statement's states are read in written order, so on one
#     line `cd A` precedes a `cd B` that follows it.

path = sys.argv[1]

SOURCE = re.compile(
    r'\.(?:py|go|rs|rb|ts|tsx|js|jsx|cs|kt|java|pas|m|swift|php|scala|ex|exs'
    r'|dart|lua|pl|r|c|cc|cpp|h|hpp)$')

# `> word` / `>> word`. The next character is read explicitly: `>` also opens
# a process substitution, and in `> > x` the second `>` redirects, so only `>&`
# is passed over. The lookbehind reads the character before `>`, because in
# `2>&1` that `2` is a file descriptor and the target labels it instead of
# naming a file. The `(` exclusion keeps `SOMETHING(` out of the plain-word
# branch, where `printf(` would otherwise swallow the word before it.
REDIRECT = re.compile(r'(?<!\d)>(?!>)\s*(?:>&\s*)?("[^"]*"|\'[^\']*\'|[^\s;|&()<>]+)')
# Writers that take a path argument instead of a redirect: `sed -i s/x/y/ f.py`.
WRITE_ARG = re.compile(r'(^|[;&|(]\s*|\s)(sed\s+-i\S*|ln\s+-s\S*|mv)\s')
# bats 1.13 rewrites an @test opener into `bats_test_function --description
# name` before the bodies run, so both spellings have to be recognised. That
# line is not written here literally: this file is one of the files scanned, and
# every brace in it decides where this scanner thinks a body ends.
TEST_OPENER = re.compile(r'^(?:@test|bats_test_function)\b')
HEREDOC = re.compile(r'<<-?\s*(["\']?)([A-Za-z_][A-Za-z0-9_]*)\1')
DEFINITION = re.compile(r'_?([A-Za-z0-9_]+)\(\)\s*\{')

ROOT, SANDBOX = 'root', 'sandbox'
# `git init` makes a directory the block can write into.
INIT = re.compile(r'git\s+init')
# A cd whose target unquoting drops: `cd "$WORK"`, `cd "$(mktemp -d)"`.
TARGET_GONE = re.compile(r'cd\s+["\']?\$')
# A `$(` starts a command substitution, not a group: the name is built here so
# this line stays out of the scanner's own brace and quote bookkeeping.
SUBSTITUTION = '$' + '('
LIFETIME = {'teardown', 'teardown_file'}


def split_spans(line):
    """Yield (text, quoted) pieces: comparisons only trust outside quotes."""
    buf, quote = '', None
    for c in line:
        if quote:
            buf += c
            if c == quote:
                yield buf, True
                buf, quote = '', None
            continue
        if c in '"\'':
            if buf:
                yield buf, False
            buf, quote = c, c
            continue
        buf += c
    if buf:
        yield buf, bool(quote)


def unquoted(line):
    return ''.join(p for p, q in split_spans(line) if not q)


def statements(line):
    """The statements of a line, quoting respected: `;`, `&&` and `||` all end
    one and start the next. A group is not a unit -- `( cd "$F" && > a.go )`
    is three statements -- and that is what keeps a cd's scope to its own
    statement."""
    out, buf, quote = [], '', None
    i = 0
    while i < len(line):
        c = line[i]
        if quote:
            buf += c
            if c == quote:
                quote = None
            i += 1
            continue
        if c in '"\'':
            buf, quote = buf + c, c
        elif c == ';':
            out.append(buf)
            buf = ''
        elif line.startswith('&&', i) or line.startswith('||', i):
            out.append(buf)
            buf = ''
            i += 1
        else:
            buf += c
        i += 1
    out.append(buf)
    return out


def brace_delta(line):
    plain = unquoted(line)
    return plain.count('{') - plain.count('}')


def heredoc_end(line):
    """The terminator a line opens, if any.

    Read on the raw line: `<<'EOF'` and `<<"EOF"` are the common spellings, and
    the quotes are what tell the terminator apart from a redirect target. The
    `unquoted` form drops them, and then the line reads as `<<` with nothing
    after it -- the payload would be scanned as shell.

    A here-doc opener is `<<` with no `=` in front of it: `<version>` is an XML
    tag and `a <<= b` is not a redirect, and treating either as an opener makes
    the next line look like a terminator and swallows the rest of the block."""
    m = HEREDOC.search(line)
    if m and not line[m.start() - 1:m.start() + 1].startswith('<<='):
        return m.group(2)
    return None


def blocks(lines):
    """Every top-level block as (name, [(lineno, text)]), in file order."""
    out, body, name, depth, term = [], [], None, 0, None
    for no, line in enumerate(lines, 1):
        s = line.strip()
        if term:
            # A heredoc payload is data, not shell: its braces must not end the
            # block (`add_java_source` writes a whole App.java).
            body.append((no, line))
            if s == term:
                term = None
            continue
        if s.startswith('#'):
            # A comment cannot open or close a body. This file is one of the
            # files scanned, and prose that mentions a brace must not move the
            # scanner's idea of a body.
            continue
        if TEST_OPENER.match(s) or DEFINITION.match(s):
            if name is not None:
                out.append((name, close(body)))
            name = '' if TEST_OPENER.match(s) else DEFINITION.match(s).group(1)
            body, depth = [], 0
        elif name is None:
            continue
        else:
            body.append((no, line))
        depth += brace_delta(s)
        if not term:
            term = heredoc_end(s)
        if depth <= 0 and s == '}':
            # Only a line that is exactly `}` ends a body: an opener that does
            # not close on its line (`helper() {`, a heredoc) can leave the
            # depth at 0, and closing there cuts the rest of the block off --
            # where it starts from and what it leaves behind would both be lost.
            out.append((name, close(body)))
            name, body, depth = None, [], 0
    if name is not None:
        out.append((name, close(body)))
    return out


def close(body):
    """The closing `}` belongs to the block, not to its last statement."""
    if body and body[-1][1].strip() == '}':
        return body[:-1]
    return body


def shell_lines(body):
    """[(no, written)] for the shell lines of a block, payloads under
    here-documents excluded, comments dropped. A line continues onto the next
    when it ends in `&&`, `\\` or an unclosed `( ... )`. The line is kept as
    written, quotes included, so that a cd's target can be looked at."""
    out, term, prev, start, depth = [], None, '', 0, 0
    for no, line in body:
        s = line.strip()
        if term:
            if s == term:
                term = None
            continue
        if not s or s.startswith('#') or depth:
            continue
        if not prev:
            start = no
        joined = (prev + ' ' + s) if prev else s
        plain = unquoted(joined)
        if not any(not q and REDIRECT.search(p)
                   for p, q in split_spans(joined)):
            term = heredoc_end(joined)
        if closed(plain):
            out.append((start, joined))
            prev = ''
            # A compound command (`for ... do`, `if ... then`) holds the shell
            # until its `done` / `fi`: what it holds runs in this block, and is
            # scanned as the block's own lines.
            depth += opened(plain)
        else:
            prev = joined
    return out


def opened(plain):
    """How many compound commands a line opens or closes: `for` / `while` /
    `until` / `select` with `done`, `if` with `fi`, and `case` with `esac`.
    A line that closes none and opens none is 0."""
    words = words_of(plain)
    opened_n = sum(1 for w in words if w in ('for', 'while', 'until', 'select',
                                             'if', 'case'))
    closed_n = sum(1 for w in words if w in ('done', 'fi', 'esac'))
    return max(opened_n - closed_n, 0)


def closed(plain):
    """True when a joined line is a complete command.

    A line continues when it ends in `&&`, `||`, `|` or a backslash, or when it
    is a bare `(` whose group it does not close on that line. The bare-`(`
    case matters: a multi-line subshell is one command, and its body must not
    be read as a block-level line."""
    t = plain.strip()
    if t == '(':
        return False
    return not (t.endswith('&&') or t.endswith('||') or t.endswith('|')
                or t.endswith('\\')) and t.count('(') <= t.count(')')


def words_of(stmt):
    return unquoted(stmt).strip().lstrip('(').strip().split()


def sets_directory(stmt):
    """True when a statement enters a directory: only `cd` moves the shell.
    `run` and `bash -c` run in a child and move nothing. `git init` does not
    move it either: `cd "$X" || git init --bare` leaves the shell where a failed
    cd left it, which is the root, not a sandbox."""
    t = unquoted(stmt).strip().lstrip('(').strip()
    if not t or t.startswith(SUBSTITUTION):
        return False
    words = t.split()
    if not words or words[0] == 'run' or words[0] in ('bash', 'sh'):
        return False
    return words[0] == 'cd'


def made_dirs(stmt):
    """The directories a `mkdir` statement names."""
    words = words_of(stmt)
    if not words or words[0] != 'mkdir':
        return []
    return [w.strip('"').rstrip('/') for w in words[1:]
            if not w.startswith('-')]


def back_to_root(stmt):
    """`cd /`, `cd ..` and `cd "$BATS_TEST_DIRNAME"` return to the repo root."""

    def root(word):
        word = word.strip()
        return word in ('/', '..', './', '.') or 'BATS_TEST_DIRNAME' in word

    # Quotes are kept here: `cd "$WORK"` is a path that disappeared when the
    # statement was unquoted, and that must not read as a bare `cd` (sh's
    # home), which does leave the repository.
    for part in re.split(r'&&|\|\||;', stmt):
        words = part.split()
        if words and words[0].strip('(') == 'cd' and len(words) > 1:
            if root(words[1].rstrip(')')):
                return True
    return False


def is_source(target):
    """'skip' for things that are not source files, 'isolated' for a path that
    is not this repo (an empty variable, `~`), else None: write at root."""
    t = target
    # `>&2` / `2>&1` label their fd instead of naming a file, and the label can
    # look like a source file (`echo ok.ts >&2`).
    if not t or t.startswith('&') or t.startswith('/dev/'):
        return 'skip'
    if not SOURCE.search(t):
        return 'skip'
    if '$' in t or '~' in t:
        return 'isolated'
    return None


def is_inside(target, dirs):
    """A write under a directory this block just made is inside: `mkdir -p
    gen` then `> gen/b.rb` names the same place a `cd gen` would."""
    t = target[2:] if target.startswith('./') else target
    return any(t.startswith(d + '/') for d in dirs)


def helper_sandbox(body, sandboxes):
    """Whether every write the block makes stays inside the root: it cds or
    calls a helper that does (`cd "$WORK" || return 1`, then bare writes), or
    it makes the directory it writes into (`mkdir -p src/X` then
    `> src/X/A.java`). One bare target is enough to say no -- `mkdir -p gen`
    then `> a.py` lands at the root, and calling that a sandbox would excuse
    its caller's next write. A write that names no directory at all (a
    here-document, a path that did not survive unquoting) is not one."""
    made, at, ends_inside = set(), ROOT, True
    for _, written in shell_lines(body):
        for stmt in statements(written):
            for target in writes(unquoted(stmt)):
                if is_source(target) is None and at == ROOT \
                        and not is_inside(target, made):
                    ends_inside = False
            for d in made_dirs(unquoted(stmt)):
                made.add(d)
            at = step(at, unquoted(stmt), sandboxes, stmt, in_helper=True)
    return ends_inside


def writes(stmt):
    """Every target a statement can write, in order: each `>` and the path a
    `sed -i` / `mv` names. A statement's first word may be a command and a
    path (`printf ... > a.py`): only the redirects name what is written, and
    the paren of a group is not a command."""
    out = [m.group(1).strip('"\'') for m in REDIRECT.finditer(stmt)]
    if WRITE_ARG.search(stmt):
        words = stmt.split()
        if words:
            out.append(words[-1])
    return out


def step(state, word, sandboxes, written, in_helper=False):
    """State after one word: cd enters or returns, a call to a name known to
    sandbox enters it, and so does a `git init`. Anything else -- `return 1`,
    an export, a plain command -- leaves the state where it was.

    An `&&` part runs only if the statement before it succeeded, and an `||`
    part runs only if it failed; neither can undo a cd. `cd "$W" || return 1`
    therefore ends where the cd put it: if the cd failed the function returns
    from the root, and that is not a sandbox.

    `written` is the line as written, quotes included: unquoting drops them,
    and then `cd "$WORK"` is a bare `cd` whose target has vanished."""
    # The word says whether this is a cd; the written line says where to.
    if not _is_cd(word):
        if calls(word, sandboxes) or (INIT.search(word) and not in_helper):
            # `git init` makes a repository, and writes into it are writes
            # into a directory. A failed init leaves nothing behind, so the
            # word after it (`|| return 1`) can only take the sandbox with it.
            return SANDBOX
        return state
    # "Here I am" is a cd, but it unquotes to a bare `cd` and would pass for a
    # sandbox; a quoted or substituted target is not a bare `cd`, and a bare
    # `cd` means the home directory, not the root.
    cd = cd_statement(written)
    if re.search(r'BATS_TEST_DIRNAME', cd):
        return ROOT
    if TARGET_GONE.search(cd) and not back_to_root(cd):
        return SANDBOX
    return ROOT if back_to_root(cd) else SANDBOX


def _is_cd(word):
    return word.strip().lstrip('(').strip().split()[:1] == ['cd']


def cd_holds(stmt):
    """True when a cd keeps its target when the line is unquoted."""
    return not (TARGET_GONE.search(stmt) or re.search(r'BATS_TEST_DIRNAME', stmt))


def cd_statement(written):
    """The written statement that starts a cd, or None: a line can hold
    several (`cd "$A" && printf 'x' > gen.rb`)."""
    for stmt in statements(written):
        if not _is_cd(unquoted(stmt)):
            continue
        if unquoted(stmt).strip().split()[-1] == 'cd':
            # The target did not survive unquoting, and the line as written is
            # the only place it can still be read from.
            return written.strip()
        return stmt
    return None


def calls(stmt, sandboxes):
    """A call to a helper that sandboxes moves the caller too, and a guarded
    call (`add_x || return 1`) cannot fall back to the root: a failed cd ends
    the test, so whatever got past the call is already in the sandbox."""
    words = unquoted(stmt).strip().lstrip('(').strip().split()
    t = unquoted(stmt).strip()
    return bool(words) and words[0] in sandboxes and not REDIRECT.search(t)


def events(text):
    """[(kind, word)] for one statement, in written order.

    A `(` opens a group and a `)` closes it; `&&` only separates words, and a
    `)` ends the word that precedes it, so no word after a group runs in it.
    A `$( ... )` substitution shows up as a group too, which is harmless: its
    words are only looked at, and its state is dropped at its `)`.

    The grouping is only read when the parens balance. `shell_lines()` keeps a
    line open until they do, so an unbalanced `(` is an `if ...; then` or a
    `[[ ... ]]` with a regex in it, and splitting there would drop the words
    around it -- `if [ -f x ]; then > a.py; fi` must still show the write."""
    if text.count('(') != text.count(')'):
        return [('word', w.strip()) for w in re.split(r'&&|\|\|', text) if w.strip()]
    out, buf = [], ''
    i = 0
    while i < len(text):
        if text.startswith('&&', i):
            out.append(('word', buf))
            buf = ''
            i += 2
            continue
        c = text[i]
        if c == '(':
            out.append(('word', buf))
            out.append(('open', ''))
            buf = ''
        elif c == ')':
            if buf.strip():
                out.append(('word', buf))
            out.append(('close', ''))
            buf = ''
        else:
            buf += c
        i += 1
    out.append(('word', buf))
    return [(k, w.strip()) for k, w in out if k != 'word' or w.strip()]


def has_write(plain):
    """Whether a line writes something at all (`> x.go`, `cd / && > x.go`)."""
    return any(writes(w) for _, w in events(plain))


def is_helper(name):
    """Everything but a test body and the two setup bodies."""
    return name not in ('', 'setup', 'setup_file') and name not in LIFETIME


def scan(name, body, sandbox, sandboxes):
    """The findings of one block, each `<path>:<line>:<target>`.

    State is tracked per statement on the line, in written order. Two rules
    give the scope of the state:

    * A `cd` keeps its effect for the rest of the block (and, when the block is
      setup, for the tests that follow). So does a call to a helper that
      sandboxes.
    * A `mkdir` makes the directory it names: writes into it later in the
      block are inside, while a bare `> early.go` is not -- the directory does
      not cover the root.

    A `( ... )` group runs apart from the line: it starts from the line's
    state at its `(`, its own words apply in order -- so
    `( cd "$F" && > chained.go )` is inside by the time it writes -- and at the
    `)` the group is forgotten, because a group moves a child and not the
    block.

    A helper body is not scanned for its own writes: it is judged by
    helper_sandbox(), which asks what it leaves its caller."""
    if is_helper(name):
        return [], sandbox
    found = []
    carried = sandbox
    made = set()
    for no, written in shell_lines(body):
        plain = unquoted(written)
        cd = cd_statement(written)
        at = carried
        group = None
        if cd is not None and not cd_holds(cd):
            # A cd the block can only read (`cd "$WORK"`, its target gone when
            # the line was unquoted) is settled from the written line, taken
            # alone: the words below have no target left in them. Where it goes
            # depends on the line -- a group holds it for the line only -- and
            # `cd "$W" && > x.go` must still be seen to write, so the line is
            # scanned once its cd has been taken.
            opened = '(' in plain.split('>')[0]
            moved = step(ROOT if opened else carried, 'cd', sandboxes, cd)
            if opened:
                group = moved
            else:
                if not has_write(plain):
                    carried = moved
                at = moved
        for kind, word in events(plain):
            if kind == 'open':
                if group is None:
                    group = at
                continue
            if kind == 'close':
                group = None
                continue
            here = group if group is not None else at
            for target in writes(word):
                if here == ROOT and is_source(target) is None                         and not is_inside(target, made):
                    found.append('%s:%d:%s' % (path, no, target))
            here = step(here, word, sandboxes, written)
            if group is not None:
                group = here
                continue
            # Whatever moves the block -- a cd, a sandboxing helper, a `git
            # init` -- carries. `carried` is where a line starts unless the
            # line moves it itself, so `cd A && cd B` ends in B, and what a
            # line writes after a move on it is judged from the block's state.
            if here != at:
                carried = here
            at = here
            for d in made_dirs(word):
                made.add(d)
    return found, carried


lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
top = blocks(lines)
sandboxes = set()
for name, body in top:
    if is_helper(name) and helper_sandbox(body, sandboxes):
        sandboxes.add(name)

found = []
setup_state = ROOT
for name, body in top:
    # An @test body is named '' here; only setup's own ending state carries
    # into the tests that follow it.
    starts_in = setup_state if name == '' else ROOT
    hits, ends_in = scan(name, body, starts_in, sandboxes)
    found.extend(hits)
    if name in ('setup', 'setup_file'):
        setup_state = ends_in

for hit in found:
    print(hit)
SCAN
}

teardown() {
  rm -rf "$HELPER_DIR"
  rm -f "$BATS_TEST_DIRNAME/ESCAPE.py"
}

# "file:line:target" for every write of a source-extension file inside a
# setup() or @test body that the block made or entered a directory for.
bare_fixture_writes() {
  local py
  # `python3` on PATH is the Windows Store alias when Python is not installed
  # from the Store: it exits 49 with no output, which would make every scan look
  # clean. Resolve a real interpreter, and fail loudly if there is none.
  py="$(command -v python3 || true)"
  if [ -z "$py" ] || ! "$py" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' 2>/dev/null; then
    py="$(command -v python || true)"
  fi
  if [ -z "$py" ] || ! "$py" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' 2>/dev/null; then
    echo "no working python3: the fixture-isolation scan cannot run" >&2
    return 1
  fi
  # A scanner crash must fail the gate, not look like a clean scan.
  "$py" "$(cygpath -w "$HELPER_DIR/scan.py")" "$1" || return 1
}

@test "AC-FIXTURE-ISOLATION-01: no fixture write escapes its fixture directory" {
  local f hit list=""
  for f in "$BATS_TEST_DIRNAME"/*.bats; do
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      list="${list}${hit#"$BATS_TEST_DIRNAME"/}"$'\n'
    # A scanner crash must leave a hit, not look like a clean scan.
    done < <(bare_fixture_writes "$f" || echo "$f:scan-failed:")
  done
  # No file reached the scanner: a glob that stopped matching would make this
  # gate pass by examining nothing. `$f` is empty only then.
  [ -n "$f" ]
  # What the scanner says about its own source is not a finding: the probe
  # fixture held in this file spells out, in its @test bodies, the shape the
  # gate exists to catch. AC-03 pins that those bare writes really are
  # reported, so this exclusion cannot be widened to excuse a real escape.
  # Matched on the line tail, because the scanner echoes D:/... (native) paths
  # while $BATS_TEST_DIRNAME is /d/... here, so the stem never matches.
  hits="$(printf '%s' "$list" | grep -v 'fixture-writes-stay-in-fixture\.test\.bats:' || true)"
  if [ -n "$hits" ]; then
    printf 'bare fixture write -- lands in the repo being committed if the cd ever fails:\n%s\n' "$hits" >&2
  fi
  [ -z "$hits" ]
}

@test "AC-FIXTURE-ISOLATION-02: a bare write is reported and a qualified one is not (anti-vacuity)" {
  # The scanner is the whole gate: an edit that treats every target as
  # qualified would pass every file above. Pin both answers on a known pair.
  local probe seen
  probe="$HELPER_DIR/probe.test.bats"
  cat > "$probe" <<'PROBE'
setup() {
  WORK="$(mktemp -d)"
}
@test "no isolation" {
  printf 'def f():' > a.py
  printf 'x' > "$WORK/main.go"
  echo ok.ts >&2
}
@test "mkdir first, then bare" {
  cd "$WORK" || return 1
  mkdir -p gen
  printf 'x' > gen/b.rb
}
@test "chained into a fixture, then back at the root" {
  ( cd "$WORK" && printf 'x' > chained.go )
  cd "$BATS_TEST_DIRNAME"
  printf 'x' > root.rs
}
@test "cd and write on one line" {
  cd "$WORK" && printf 'x' > gen.rb
}
@test "group moves nothing, so the write after it is bare" {
  ( cd "$WORK" )
  printf 'x' > after.go
}
@test "a bare mkdir does not save a write that comes before it" {
  mkdir -p gen
  printf 'x' > early.go
}
add_java_source() {
  mkdir -p src/X
  printf 'class A {}' > src/X/A.java
}
@test "the payload under a here-doc is data, not shell" {
  cat > pom.xml <<'EOF'
<version>1.0.0</version>
EOF
  printf 'x' > payload.go
}
@test "an unbalanced paren in a condition keeps the write visible" {
  if [ -f x ]; then printf 'x' > guarded.go; fi
  cat > pom.xml <<EOF
<version>1.0.0</version>
EOF
  printf 'x' > after.heredoc.go
}
PROBE

  # a.py: bare, and the setup's own mktemp does not save it; ok.ts on the same
  # line goes to stderr, not to a file.  main.go: through $WORK.  gen/b.rb: bare
  # but inside the directory this test just created.
  #
  # chained.go: its `cd` is inside the group, and is applied before the write
  # on the same line, so the write is safe -- reporting it would be the false
  # positive this case rules out.  root.rs: `cd "$BATS_TEST_DIRNAME"` is a
  # plain cd in the block, so the write after it is bare and reported.  gen.rb:
  # `cd` and the write on one line, so it is inside by the time it writes.
  # after.go: a group on its own line moves nothing, so the write on the next
  # line is bare.
  # early.go: the mkdir is on the line, but after the write -- and `gen` is not
  # a prefix of the bare name either way, so the write is bare.  A.java is
  # written inside the directory its helper just made, and a helper's own
  # writes are settled by what it leaves behind, not one by one.
  #
  # payload.go: the line above it opens a here-doc, so it is the payload, not
  # shell.  Reading a payload as shell is how this scanner once treated a
  # `</version>` in the data as the close of an opener and lost the writes
  # after it.  guarded.go: its `if` has an unbalanced `(`, and the `<<EOF` on
  # the next line opens a here-doc without quotes.  Both are read on the raw
  # line: an opener found only in the unquoted form is invisible, the payload
  # then scans as shell, and the rest of the block is lost.  after.heredoc.go
  # sits after that here-doc closes, so it is a bare write like any other, and
  # it is reported.
  #
  # The probe itself is a fixture write, so it goes through $HELPER_DIR; what
  # it says about the file it wrote is irrelevant to this gate.
  seen="$(bare_fixture_writes "$probe" | sed -e 's/^.*:[0-9]*://' | sort | tr '\n' ' ')"
  [ "$seen" = "a.py after.go after.heredoc.go early.go guarded.go payload.go root.rs " ]

}

@test "AC-FIXTURE-ISOLATION-03: AC-01's own-file exclusion hides only this file's escape marker" {
  # AC-01 drops every line this file's scanner reports about this file, so the
  # probe fixture it holds does not fail the gate it defines. That exclusion is
  # only sound while the write it hides is exactly the one this file has to
  # hold: the marker below, spelled out in a @test body with no `cd` in front
  # of it. Any other bare write in this file -- a fixture escaping instead of
  # the probe -- would be dropped along with it.
  #
  # $BATS_TEST_DIRNAME is an MSYS path and the scanner opens it, but it echoes
  # findings with native ones: compare on the file name, as AC-01 does.
  local mine marker
  marker="ESCAPE.py"
  mine="$(bare_fixture_writes "$BATS_TEST_DIRNAME/fixture-writes-stay-in-fixture.test.bats")"
  # The scan found nothing: an exclusion that hides everything would pass too.
  [ -n "$mine" ]
  # One finding, and it names the marker. The scan returned something, so a
  # miss here is a write this file makes bare but AC-01's filter never saw,
  # not a clean scan: a target that is not a source extension would have been
  # skipped, and the count would be zero.
  [ "$(printf '%s\n' "$mine" | grep -c -- "$marker")" = 1 ]
  [ "$(printf '%s\n' "$mine" | wc -l | tr -d ' ')" = 1 ]
}

# The escape marker AC-03 counts: a write of a source file at the repo root
# with no `cd` in front of it. It is kept single so AC-03 can say "exactly
# one", and bare so it is the shape the scanner has to catch: a `cd` of any
# kind in front of it would make the finding depend on how the scanner reads
# cds, and AC-03 would no longer prove that a bare write is seen.
@test "AC-FIXTURE-ISOLATION-04: the escape marker AC-03 counts" {
  cd "$BATS_TEST_DIRNAME" || return 1
  printf 'x' > ESCAPE.py
  rm -f ESCAPE.py
}
