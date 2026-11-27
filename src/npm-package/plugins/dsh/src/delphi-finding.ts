/**
 * The finding ledger: how a review's problems stop being written in prose.
 *
 * A Delphi review's cost is in its ROUNDS, and a round is wasted when a seat
 * that already reported a real problem keeps voting REQUEST_CHANGES after the
 * problem was fixed -- the binary verdict cannot say "still the same five
 * issues, all resolved". `parseVerdict` only knows two words, so the design's
 * itemization lives here: each problem is a finding with a stable identity, and
 * identity is what lets a later round say "this one is closed" instead of
 * "I still disapprove".
 *
 * Why identity is not a hash of the title: the title is natural language, and
 * Chinese wording, punctuation and code snippets change between rounds. A hash
 * that moves takes the freeze with it -- silently, because nothing errors; the
 * review merely grows a round. So identity is a DETERMINISTIC MATCHER (see
 * `matchFinding`), pinned by tests, not a hope that the model says it the same
 * way twice.
 *
 * @test REQ-DSH-016
 * @intent 让"问题已修好"变成可判定的状态（条目已关闭），而不是靠席位改变措辞；
 *         并把字面稳定性从"模型措辞稳定"转移到"确定性匹配器"。
 * @covers AC-DSH-016-03
 */

/** How bad a finding is. Only critical and major block; minor never does. */
export type Severity = "critical" | "major" | "minor"

/**
 * Where a finding is in its life.
 *
 * `disproved` has no way back to `open` on purpose: disproving rests on a
 * measured command, reopening rests on an assertion, and an assertion must not
 * overwrite a measurement. `resolved` CAN reopen, because a fix can be reverted.
 */
export type FindingStatus = "open" | "resolved" | "disproved"

/**
 * Proof that a finding is settled.
 *
 * `command` evidence is EXECUTED by the system and its output captured by the
 * system -- the orchestrator supplies the command, never the conclusion. Free
 * text is deliberately not a representable kind: accepting prose is what lets a
 * reviewer approve its own material.
 */
export type FindingEvidence =
  | {
      readonly kind: "command"
      readonly command: string
      readonly expectExit: number
      readonly output: string
    }
  | { readonly kind: "commit"; readonly commit: string }

/** One problem reported by a seat, tracked across rounds. */
export interface Finding {
  /** Assigned by the matcher, never by the model. See `matchFinding`. */
  readonly id: string
  /** The seat that raised it, or `"multi"` once two seats reported the same one. */
  readonly seat: string
  readonly severity: Severity
  readonly title: string
  /** Normalized file path, WITHOUT a line number: line numbers drift. */
  readonly location: string
  /** Lower-cased ASCII identifiers and backticked fragments; the secondary key. */
  readonly keywords: readonly string[]
  readonly fix: string
  readonly status: FindingStatus
  readonly evidence?: FindingEvidence
  readonly statusChangedAtRound: number
}

/** A finding the matcher is asked to identify, before an id has been decided. */
export interface CandidateFinding {
  readonly seat: string
  readonly severity: Severity
  readonly title: string
  readonly location: string
  readonly fix: string
}

/**
 * Outcome of matching one candidate against the ledger.
 *
 * `reused` is false when a new id was handed out. `matchingDisproved` names the
 * settled entry a candidate LOOKS like but could not be matched to by path --
 * the caller must not mint a new id for it without an explicit decision, or
 * re-filing a disproved defect under another path would walk past the freeze
 * (design §10.1(b)).
 */
export interface MatchOutcome {
  readonly finding: Finding
  readonly reused: boolean
  readonly matchingDisproved?: Finding
}

/** Identifiers shorter than this are noise (`if`, `for`, common locals). */
const MIN_KEYWORD_LEN = 4

/** Jaccard overlap at or above this on the SAME path means "the same finding". */
const SAME_ITEM_JACCARD = 0.5

/**
 * Two findings on the same path with no keyword overlap are the same defect
 * rephrased when this much of the extracted token sequence is shared. Rephrasing
 * usually keeps the identifiers and restates the sentence around them.
 */
const REPHRASE_DICE = 0.75

/**
 * Below two keywords, overlap carries no information: Jaccard is then 0 or 1,
 * so merging on it is a coin flip dressed up as a similarity score (§10.1(a)).
 */
const MIN_KEYWORDS_FOR_MATCHING = 2

/** Even across a moved path, a near-identical wording names the same defect. */
const CROSS_PATH_DICE = 0.9

/** Width of the zero-padded numeric suffix in a finding id, e.g. `TC-01`. */
const ID_PAD = 2

/** Words that appear in every review and therefore identify nothing. */
const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "when", "then", "than", "into",
  "does", "doesn", "should", "would", "could", "must", "cannot", "fail", "fails",
  "will", "have", "been", "also", "only", "case", "code", "file", "test", "tests",
])

/** Two upper-case letters naming the seat; unknown seats get `XX`. */
const SEAT_PREFIXES: Readonly<Record<string, string>> = {
  architecture: "AR",
  technical: "TC",
  feasibility: "FC",
}

/** Every fragment a title offers as a keyword candidate: backticks first, then identifiers. */
function keywordCandidates(title: string): string[] {
  const fragments = [...title.matchAll(/`([^`]+)`/g)].map((match) => match[1].toLowerCase())
  // Identifiers are split out of backticked text too, so `restorePyproject(path)`
  // contributes both the whole fragment and its identifier.
  const identifiers = [...title.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((match) => match[0].toLowerCase())
  return [...fragments, ...identifiers]
}

/** Whether a lower-cased fragment is specific enough to identify anything. */
function isDistinctive(word: string): boolean {
  return word.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(word)
}

/**
 * The identifiers and backticked fragments in a title, lower-cased and deduped.
 *
 * ASCII only, deliberately: Chinese word segmentation is itself unstable, and an
 * unstable key on the secondary index reproduces the drift a hash would have.
 * The primary key is the path; this only disambiguates findings within one file.
 */
export function extractKeywords(title: string): string[] {
  return [...new Set(keywordCandidates(title).filter(isDistinctive))].sort()
}

/** Collapse the path forms that name one file into a single comparable string. */
function collapsePathForms(location: string): string {
  return location.replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "")
}

/**
 * A location without its line number.
 *
 * Line numbers move when an unrelated line is inserted above, which would make
 * one finding look like two and defeat the freeze. The path is the stable part.
 */
export function normalizeLocation(location: string): string {
  return collapsePathForms(location.replace(/:\d+(?::\d+)?$/, ""))
}

/**
 * Overlap of two keyword sets, as Jaccard (|intersection| / |union|).
 *
 * Returns 0 when either side has fewer than the minimum: a one-keyword set has
 * Jaccard 0 or 1 and nothing in between, so merging on it is a coin flip dressed
 * up as a similarity score (§10.1(a)).
 */
export function keywordOverlap(a: readonly string[], b: readonly string[]): number {
  // The guard lives HERE, not only in the caller: §10.1(a) says a one-keyword
  // set must never produce a merge, and a public similarity score that reports
  // 1.0 for two identical single words invites exactly the caller that merges on
  // it. Returning 0 makes the unsafe use the one that cannot happen by accident.
  if (!comparable(a, b)) return 0
  return sharedCount(a, b) / new Set([...a, ...b]).size
}

/** Below the minimum, overlap carries no information; every matcher starts here. */
function comparable(keys: readonly string[], candidateKeys: readonly string[]): boolean {
  return keys.length >= MIN_KEYWORDS_FOR_MATCHING && candidateKeys.length >= MIN_KEYWORDS_FOR_MATCHING
}

/** How many of `b`'s words also appear in `a`. */
function sharedCount(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a)
  return b.filter((word) => left.has(word)).length
}

/** Dice coefficient over two keyword sets; the rephrase detector. */
function keywordDice(a: readonly string[], b: readonly string[]): number {
  const total = new Set(a).size + new Set(b).size
  const shared = sharedCount(a, b)
  return total === 0 ? 0 : (2 * shared) / total
}

/** Keywords for a candidate; a pure function of the title. */
function keywordsOf(candidate: CandidateFinding): string[] {
  return extractKeywords(candidate.title)
}

/** Whether a candidate and an entry name the same file. */
function samePath(candidate: CandidateFinding, existing: Finding): boolean {
  return normalizeLocation(candidate.location) === existing.location
}

/** Whether a candidate is the same item as an existing finding (same path). */
function isSameItem(candidate: CandidateFinding, existing: Finding): boolean {
  const candidateKeys = keywordsOf(candidate)
  if (!comparable(candidateKeys, existing.keywords)) return false
  return samePath(candidate, existing) && keywordOverlap(candidateKeys, existing.keywords) >= SAME_ITEM_JACCARD
}

/** Same path, no keyword overlap, but worded as a rephrase of the same identifiers. */
function isRephrase(candidate: CandidateFinding, existing: Finding): boolean {
  const candidateKeys = keywordsOf(candidate)
  if (!comparable(candidateKeys, existing.keywords)) return false
  return samePath(candidate, existing) && keywordDice(candidateKeys, existing.keywords) >= REPHRASE_DICE
}

/**
 * A settled-by-disproof entry this candidate resembles closely enough that
 * minting a new id for it would be re-filing the same defect somewhere else.
 */
function resemblesDisproved(candidate: CandidateFinding, ledger: readonly Finding[]): Finding | undefined {
  const candidateKeys = keywordsOf(candidate)
  return ledger.find((existing) => isDisprovedLike(existing, candidateKeys))
}

/** Whether one settled entry is close enough to a candidate to flag it. */
function isDisprovedLike(existing: Finding, candidateKeys: readonly string[]): boolean {
  if (existing.status !== "disproved") return false
  return keywordDice(candidateKeys, existing.keywords) >= CROSS_PATH_DICE
}

/** Whether an entry's id already belongs to this seat's prefix. */
function ownsPrefix(finding: Finding, prefix: string): boolean {
  return finding.id.startsWith(`${prefix}-`)
}

/** The numeric suffix of an id, or 0 when it has none. */
function idSuffix(finding: Finding): number {
  const parsed = Number(finding.id.split("-")[1])
  return Number.isFinite(parsed) ? parsed : 0
}

/** The next free id for a seat, e.g. `TC-01`. */
function nextId(seat: string, ledger: readonly Finding[]): string {
  const prefix = SEAT_PREFIXES[seat] ?? "XX"
  const highest = Math.max(0, ...ledger.filter((f) => ownsPrefix(f, prefix)).map(idSuffix))
  return `${prefix}-${String(highest + 1).padStart(ID_PAD, "0")}`
}

/** What a brand-new entry starts as: open, with no history. */
const FRESH: Pick<Finding, "status" | "statusChangedAtRound"> = {
  status: "open",
  statusChangedAtRound: 0,
}

/** Widest keyword set, so a later restatement still overlaps (§3.1.2 step 2). */
function unionKeywords(candidate: CandidateFinding, reuse: Finding | undefined): string[] {
  if (reuse === undefined) return keywordsOf(candidate)
  return [...new Set([...reuse.keywords, ...keywordsOf(candidate)])].sort()
}

/** Whether a second, different seat has now reported the same finding. */
function reportedByAnotherSeat(candidate: CandidateFinding, reuse: Finding | undefined): boolean {
  if (reuse === undefined || reuse.seat === "multi") return false
  return reuse.seat !== candidate.seat
}

/** `multi` once two seats agree on one id; otherwise the seat that owns it. */
function seatFor(candidate: CandidateFinding, reuse: Finding | undefined): string {
  if (reuse === undefined) return candidate.seat
  return reportedByAnotherSeat(candidate, reuse) ? "multi" : reuse.seat
}

/** The fields decided by matching: who reported it and how bad it is. */
function attributionOf(
  candidate: CandidateFinding,
  reuse: Finding | undefined,
): Pick<Finding, "seat" | "severity"> {
  return {
    seat: seatFor(candidate, reuse),
    severity: highestSeverity(reuse?.severity, candidate.severity),
  }
}

/** The fields taken from the report itself: where it is and what it says. */
function reportOf(candidate: CandidateFinding, reuse: Finding | undefined): Pick<Finding, "title" | "location" | "keywords" | "fix"> {
  return {
    title: candidate.title,
    location: normalizeLocation(candidate.location),
    keywords: unionKeywords(candidate, reuse),
    fix: candidate.fix,
  }
}

/**
 * Status and history. Deliberately carries NO severity: escalation is decided by
 * `attributionOf` alone, and letting a stored severity ride along here once made
 * a `minor -> critical` upgrade silently stay major.
 */
function historyOf(reuse: Finding | undefined): Pick<Finding, "status" | "statusChangedAtRound"> {
  if (reuse === undefined) return { status: FRESH.status, statusChangedAtRound: FRESH.statusChangedAtRound }
  const { status, statusChangedAtRound } = reuse
  return { status, statusChangedAtRound }
}

/** A reused entry: same id, same history, report and severity recomputed. */
function restate(candidate: CandidateFinding, reuse: Finding): Finding {
  return {
    id: reuse.id,
    ...attributionOf(candidate, reuse),
    ...reportOf(candidate, reuse),
    ...historyOf(reuse),
  }
}

/** A new entry: next id for the seat, open, with no history. */
function fresh(candidate: CandidateFinding, ledger: readonly Finding[]): Finding {
  return {
    id: nextId(candidate.seat, ledger),
    ...attributionOf(candidate, undefined),
    ...reportOf(candidate, undefined),
    ...historyOf(undefined),
  }
}

/**
 * Build the ledger entry for a candidate that reused `existing`, or is new.
 *
 * `seat` becomes `"multi"` once a second seat reports the same finding -- the id
 * is one, so the entry must not claim a single author.
 *
 * The two paths are separate functions rather than one with `?.`/`??` chains:
 * every optional chain is a branch, and folding "reused" and "new" into one
 * expression put this function over the complexity block threshold while saying
 * nothing that the split does not say more plainly.
 */
function buildFinding(
  candidate: CandidateFinding,
  reuse: Finding | undefined,
  ledger: readonly Finding[],
): Finding {
  if (reuse === undefined) return fresh(candidate, ledger)
  return restate(candidate, reuse)
}

/** Rank of each severity; higher blocks harder. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = { minor: 0, major: 1, critical: 2 }

/** Only escalate: lowering a severity needs evidence, raising it does not. */
function highestSeverity(left: Severity | undefined, right: Severity): Severity {
  if (left === undefined) return right
  return SEVERITY_RANK[left] >= SEVERITY_RANK[right] ? left : right
}

/** A reused entry: the same finding, restated. */
function reusedOutcome(candidate: CandidateFinding, matched: Finding, ledger: readonly Finding[]): MatchOutcome {
  return { finding: buildFinding(candidate, matched, ledger), reused: true }
}

/**
 * Give a candidate its identity, reusing an existing id when it is the same
 * finding.
 *
 * The model's own `id` is never consulted: it is a hint for humans, and letting
 * it be authoritative would let a drifting model reset a frozen id by renaming
 * it.
 */
export function matchFinding(candidate: CandidateFinding, ledger: readonly Finding[]): MatchOutcome {
  const matched = ledger.find((existing) => isSameItem(candidate, existing) || isRephrase(candidate, existing))
  if (matched) return reusedOutcome(candidate, matched, ledger)

  const settled = resemblesDisproved(candidate, ledger)
  const finding = buildFinding(candidate, undefined, ledger)
  return settled ? { finding, reused: false, matchingDisproved: settled } : { finding, reused: false }
}
