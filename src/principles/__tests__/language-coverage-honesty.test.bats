#!/usr/bin/env bash
#
# @test REQ-PRINCIPLES-LANGUAGE-COVERAGE
# @intent Gate 4 reports "✓ No violations found" for languages it cannot examine.
#
#         A 6-level nested Python function was analysed and the gate said:
#
#           ✓ No violations found
#           Files checked: 1
#           Rules run: 21
#
#         21 rules "ran" against a file none of them can read. The same file shape
#         in TypeScript is reported correctly, which is what makes this invisible:
#         the gate is not broken, it is uneven, and its success message does not
#         distinguish "examined and clean" from "not examined".
#
#         Root cause is a size asymmetry in src/principles/adapters/:
#
#           typescript.ts  970 lines   real rules
#           java.ts        544 lines   real rules
#           csharp.ts      339 lines   real rules
#           cpp.ts         167 lines   detect + regex extraction only
#           python.ts      115 lines   detect + regex extraction only
#           objectivec.ts   82 lines   detect + regex extraction only
#           php.ts          77 lines   detect + regex extraction only
#           go.ts           54 lines   detect + regex extraction only
#           kotlin.ts       53 lines   detect + regex extraction only
#           dart.ts         43 lines   detect + regex extraction only
#           swift.ts        39 lines   detect + regex extraction only
#
#         Every adapter makes the language DETECTABLE. Ten of the eleven do not
#         make it EXAMINABLE. The gate then has no way to tell the difference,
#         because "no rule matched" and "no defect found" produce the same output.
#
#         This is the family AGENTS.md calls the most repeated defect here --
#         "not checked" must never be indistinguishable from "passed" -- and it is
#         the one the objective names explicitly. The fix is not to write ten
#         analysers; it is to make the gate SAY which languages it actually
#         examined, so a green column stops implying coverage it does not have.
#
# @covers AC-PRINCIPLES-LANG-01
# @covers AC-PRINCIPLES-LANG-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  CLI="$REPO/src/npm-package/bin/xp-gate.js"
  FIX="$BATS_TEST_TMPDIR/fix"
  mkdir -p "$FIX"
}

# A 6-level nesting, past the deep-nesting threshold of 4. Written per language
# because the syntax differs; the property under test is the same.
write_nested() {
  local file="$1" lang="$2"
  case "$lang" in
    python)
      cat > "$FIX/$file" <<'EOF'
def f():
    if a:
        if b:
            if c:
                if d:
                    if e:
                        if g:
                            x()
EOF
      ;;
    go)
      printf 'package main\n\nfunc f() {\n\tif a {\n\t\tif b {\n\t\t\tif c {\n\t\t\t\tif d {\n\t\t\t\t\tif e {\n\t\t\t\t\t\tif g {\n\t\t\t\t\t\t\tx()\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n' > "$FIX/$file"
      ;;
    swift)
      printf 'func f() {\n  if a {\n    if b {\n      if c {\n        if d {\n          if e {\n            if g { x() }\n          }\n        }\n      }\n    }\n  }\n}\n' > "$FIX/$file"
      ;;
    typescript)
      printf 'function f() {\n  if (a) {\n    if (b) {\n      if (c) {\n        if (d) {\n          if (e) {\n            if (g) {\n              x();\n            }\n          }\n        }\n      }\n    }\n  }\n}\n' > "$FIX/$file"
      ;;
  esac
}

@test "AC-PRINCIPLES-LANG-01 typescript fixture is sound" {
  # Anti-vacuity guard for the whole file: if this fixture does not trip the
  # rule, then "python found nothing" proves nothing at all -- the nesting shape
  # itself might be wrong.
  write_nested "a.ts" typescript
  run bash -c "cd '$REPO/src/npm-package' && node '$CLI' principles '$FIX' 2>&1"
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
  printf '%s' "$output" | grep -qiE 'violation' || {
    echo "the TypeScript fixture produced no violation at all, so the comparison"
    echo "below would be meaningless:"
    printf '%s\n' "$output" | tail -8
    return 1
  }
  # NOTE: written as an if-block rather than "grep ... && return-block". Under bats
  # the && form reports a failure whenever grep does NOT match -- i.e. precisely
  # when the assertion holds. Measured: this test failed at its own assertion line
  # while the fixture behaved correctly.
  if printf '%s' "$output" | grep -qiE 'No violations found'; then
    echo "the TypeScript nested fixture was NOT reported; the fixture is wrong:"
    printf '%s\n' "$output" | tail -8
    return 1
  fi
}

@test "AC-PRINCIPLES-LANG-02: an unexamined language is not reported as clean" {
  # The behavioural assertion. A language the gate cannot actually analyse must
  # not produce the same "✓ No violations found" a clean TypeScript file does.
  #
  # Accepted outcomes for python/go/swift:
  #   - a violation is reported (an analyser exists after all), or
  #   - the language is named as NOT analysed / unsupported / skipped, with a
  #     reason.
  # Refused: a bare "✓ No violations found" with the file counted in
  # "Files checked" -- that is the false pass.
  local lang file
  local failed=""
  for pair in "python:a.py" "go:a.go" "swift:a.swift"; do
    lang="${pair%%:*}"
    file="${pair##*:}"
    # `rm -rf "$FIX"/*` is SC2115: if $FIX is empty the glob collapses to `/*`.
    # find -maxdepth 1 -delete cannot escape the directory it was given.
    find "$FIX" -mindepth 1 -maxdepth 1 -delete
    write_nested "$file" "$lang"

    run bash -c "cd '$REPO/src/npm-package' && node '$CLI' principles '$FIX' 2>&1"
    local out="$output"

    if printf '%s' "$out" | grep -qiE 'violation' && ! printf '%s' "$out" | grep -qi 'No violations found'; then
      continue   # analysed and reported
    fi
    if printf '%s' "$out" | grep -qiE "$lang" | grep -qiE 'not analysed|not analyzed|unsupported|no rules|cannot|skipped'; then
      continue   # honestly declared
    fi
    # Also accept any language name appearing next to an "unanalysed" style note.
    if printf '%s' "$out" | grep -qiE 'not analysed|not analyzed|unsupported|no analyser|no analyzer'; then
      continue
    fi
    failed="$failed $lang"
  done

  if [ -n "$failed" ]; then
    echo "these languages reported a clean result while unable to examine the file:$failed"
    echo ""
    echo "A 6-level nested function passed as '✓ No violations found' means the gate"
    echo "counted the file and applied no rule that can see it. 'Not checked' is"
    echo "being recorded as 'passed'."
    echo ""
    echo "Reproduce:"
    echo "  xp-gate principles <dir containing a.py with 6-level nesting>"
    return 1
  fi
}

@test "anti-vacuity: the adapters still declare their languages" {
  # The fix must TEACH the gate which languages it can analyse, not delete the
  # adapters. A gate that stopped detecting python would pass the two tests above
  # while losing the ability the adapters do provide.
  local f
  for f in python go swift dart kotlin cpp objectivec php; do
    [ -f "$REPO/src/principles/adapters/$f.ts" ] || {
      echo "adapter for $f is missing"
      return 1
    }
  done
  grep -q 'detectLanguage' "$REPO/src/principles/adapters/python.ts"
}