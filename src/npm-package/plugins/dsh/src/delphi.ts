/**
 * Delphi cross-review over an external OpenAI-compatible provider.
 *
 * This is the codified form of the manual run that produced PR #456: three
 * DISTINCT models, each asked the same question independently and anonymously,
 * iterated until the approval ratio clears the consensus threshold.
 *
 * Why a plugin tool rather than a shell one-liner: the DSH tool plane is where
 * a session actually lives, so the mechanism has to be callable from there.
 * DSH's own `tool-subagent` cannot serve this purpose -- subagents inherit one
 * host-configured model, so they cannot guarantee three distinct models, and
 * Delphi's whole value rests on that distinctness.
 *
 * @test REQ-DSH-016
 * @intent 用外部 provider 的多个不同模型做匿名交叉评审并判定共识，
 *         把「多模型交叉评审」固化成 DSH 可调用的机制而非一次性脚本。
 * @covers AC-DSH-016-01
 */

/** One expert seat. `model` is the id sent to the provider. */
export interface ExpertSeat {
  readonly id: string
  readonly role: string
  readonly model: string
  /** Reasoning models burn hidden tokens, so seats need independent budgets. */
  readonly maxTokens?: number
}

/** A single expert's parsed verdict for one round. */
export interface ExpertVerdict {
  readonly id: string
  readonly role: string
  readonly requestedModel: string
  readonly resolvedModel: string | null
  readonly verdict: "APPROVED" | "REQUEST_CHANGES" | "INVALID_NO_VERDICT" | "ERROR"
  readonly confidence: number
  /** Only well-formed verdicts may count toward consensus. */
  readonly counted: boolean
  readonly report: string
  readonly error?: string
}

/** Aggregated outcome of one round. */
export interface RoundResult {
  readonly round: number
  readonly verdicts: readonly ExpertVerdict[]
  readonly validCount: number
  readonly approvals: number
  readonly consensusRatio: number
  readonly reachedConsensus: boolean
}

export interface DelphiOptions {
  /** OpenAI-compatible base URL, e.g. https://host/gpt-proxy */
  readonly baseUrl: string
  /** Bearer token. Callers read this from the environment; never hardcode it. */
  readonly apiKey: string
  readonly seats: readonly ExpertSeat[]
  /** Percent, 0-100. Delphi default is 90. */
  readonly thresholdPercent?: number
  readonly maxRounds?: number
  /** Per-request ceiling; the caller owns the overall timeout. */
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

/** Delphi's defining invariant: exactly three seats and a 90% approval bar. */
const REQUIRED_EXPERTS = 3
const DEFAULT_THRESHOLD_PERCENT = 90

const DEFAULT_MAX_TOKENS = 8000
const DEFAULT_TIMEOUT_MS = 180_000

/** Raised when the configured seats cannot satisfy the Delphi invariants. */
export class DelphiConfigError extends Error {}

/**
 * Reject a seat configuration that cannot produce a valid Delphi review.
 * Checked BEFORE any network call so a misconfiguration never looks like a
 * provider failure.
 */
export function validateSeats(seats: readonly ExpertSeat[]): void {
  if (seats.length !== REQUIRED_EXPERTS) {
    throw new DelphiConfigError(
      `Delphi requires exactly ${REQUIRED_EXPERTS} experts, got ${seats.length}.`,
    )
  }
  for (const s of seats) {
    if (!s.model || s.model.trim() === "") {
      throw new DelphiConfigError(`Expert "${s.id}" has no model (a local fallback cannot count).`)
    }
    if (s.model.includes("${")) {
      throw new DelphiConfigError(`Expert "${s.id}" model "${s.model}" looks like an unexpanded env var.`)
    }
  }
  const distinct = new Set(seats.map((s) => s.model.trim()))
  if (distinct.size !== REQUIRED_EXPERTS) {
    throw new DelphiConfigError(
      `All ${REQUIRED_EXPERTS} experts must use distinct models; got: ${[...distinct].join(", ")}.`,
    )
  }
}

/**
 * Parse an expert report into a verdict.
 *
 * The verdict token usually sits on the line AFTER a "### VERDICT" heading, so
 * a same-line `VERDICT: X` pattern misses every real report. A report with no
 * recognisable verdict is INVALID, never a guess: inferring approval from prose
 * would let the gate pass on an assumption.
 */
export function parseVerdict(text: string): {
  verdict: ExpertVerdict["verdict"]
  confidence: number
} {
  const section = /VERDICT[\s\S]{0,120}?\b(APPROVED|REQUEST_CHANGES|PASS_WITH_CAVEATS|BLOCKED)\b/i.exec(text)
  if (!section) return { verdict: "INVALID_NO_VERDICT", confidence: 0 }

  const raw = section[1].toUpperCase()
  // PASS_WITH_CAVEATS / BLOCKED are not approvals under the 90% rule.
  const verdict = raw === "APPROVED" ? "APPROVED" : "REQUEST_CHANGES"

  const c = /CONFIDENCE[\s\S]{0,40}?(\d{1,2})/i.exec(text)
  const confidence = c ? Math.min(10, Math.max(0, Number(c[1]))) : 0
  return { verdict, confidence }
}

interface ChatResponse {
  model?: string
  choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
}

/** One provider call. Throws on transport failure or empty content. */
async function chatOnce(
  opts: DelphiOptions,
  seat: ExpertSeat,
  system: string,
  user: string,
): Promise<{ content: string; resolvedModel: string | null; finishReason: string }> {
  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const res = await doFetch(`${opts.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: seat.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: seat.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: 0.2,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as ChatResponse
    const content = json.choices?.[0]?.message?.content ?? ""
    const finishReason = json.choices?.[0]?.finish_reason ?? "unknown"

    // Empty content is a real failure -- typically a reasoning model that spent
    // its whole budget on hidden tokens. Never let it pass as an empty review.
    if (content.trim() === "") {
      throw new Error(
        `empty content (finish_reason=${finishReason}, max_tokens=${seat.maxTokens ?? DEFAULT_MAX_TOKENS}); ` +
          `raise max_tokens if this is a reasoning model`,
      )
    }

    return { content, resolvedModel: json.model ?? null, finishReason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run ONE round. All seats are asked concurrently and never see each other's
 * output, which is what makes the round anonymous.
 */
export async function runRound(
  opts: DelphiOptions,
  round: number,
  system: string,
  buildPrompt: (seat: ExpertSeat) => string,
): Promise<RoundResult> {
  const settled = await Promise.allSettled(
    opts.seats.map(async (seat) => {
      const r = await chatOnce(opts, seat, system, buildPrompt(seat))
      return { seat, ...r }
    }),
  )

  const verdicts: ExpertVerdict[] = settled.map((s, i) => {
    const seat = opts.seats[i]
    if (s.status !== "fulfilled") {
      return {
        id: seat.id,
        role: seat.role,
        requestedModel: seat.model,
        resolvedModel: null,
        verdict: "ERROR",
        confidence: 0,
        counted: false,
        report: "",
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      }
    }
    const { verdict, confidence } = parseVerdict(s.value.content)
    return {
      id: seat.id,
      role: seat.role,
      requestedModel: seat.model,
      resolvedModel: s.value.resolvedModel,
      verdict,
      confidence,
      counted: verdict !== "INVALID_NO_VERDICT",
      report: s.value.content,
    }
  })

  const counted = verdicts.filter((v) => v.counted)
  const approvals = counted.filter((v) => v.verdict === "APPROVED").length
  // Consensus is measured over VALID responses: a malformed report is not a
  // dissent, but it cannot be counted as agreement either.
  const ratio = counted.length === 0 ? 0 : approvals / counted.length
  const threshold = opts.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT

  return {
    round,
    verdicts,
    validCount: counted.length,
    approvals,
    consensusRatio: ratio,
    reachedConsensus: counted.length === REQUIRED_EXPERTS && ratio * 100 >= threshold,
  }
}
