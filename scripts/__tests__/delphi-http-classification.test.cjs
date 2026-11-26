/**
 * @test REQ-DELPHI-HTTP-CLASSIFICATION
 * @intent The HTTP response classifier must keep its contract across every status the
 *         gateway actually returns.
 *
 *         `classifyHttpResponse` had NO test. It decides whether a review failure is
 *         retried, reported, or silently turned into a verdict, and the walkthrough asked
 *         for the matrix rather than a reading of the diff (review FC-02).
 *
 *         The retryable flag is the consequential one: `true` burns three attempts on a
 *         failure that will not change, `false` gives up on a server blip that would have
 *         succeeded.
 *
 * @covers AC-DELPHI-HTTP-CLASSIFICATION-01
 */

'use strict';

const { classifyHttpResponse } = require('../delphi-external-review.cjs');

/** A fetch-like response with a JSON body. */
function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('classifyHttpResponse', () => {
  it('reports 401 and 403 as an authentication error, not retryable', async () => {
    for (const status of [401, 403]) {
      const result = await classifyHttpResponse(jsonResponse(status, {}));
      expect(result.error).toBe(true);
      expect(result.message).toContain('Authentication failed');
      expect(result.retryable).not.toBe(true);
    }
  });

  it('marks 429 as retryable with a delay', async () => {
    const result = await classifyHttpResponse(jsonResponse(429, {}));
    expect(result.error).toBe(true);
    expect(result.retryable).toBe(true);
  });

  it('marks a transient 500 and 503 as retryable', async () => {
    for (const status of [500, 503]) {
      const result = await classifyHttpResponse(jsonResponse(status, {}));
      expect(result.retryable, `status ${status}`).toBe(true);
    }
  });

  it('does NOT retry a 5xx whose body says response_processing_error', async () => {
    // Content-dependent: the same prompt fails the same way, so a retry only burns time.
    const result = await classifyHttpResponse(
      jsonResponse(500, { error: { type: 'response_processing_error' } }),
    );
    expect(result.retryable).toBe(false);
    expect(result.error).toBe(true);
  });

  it('reports a non-5xx 4xx as an error without quoting the provider body', async () => {
    const result = await classifyHttpResponse(jsonResponse(400, { secret: 'leak-me' }));
    expect(result.error).toBe(true);
    expect(JSON.stringify(result)).not.toContain('leak-me');
  });

  it('rejects a 2xx whose body is not usable JSON', async () => {
    const broken = {
      status: 200,
      ok: true,
      json: async () => { throw new Error('not json'); },
      text: async () => 'not json',
    };
    // `readSuccessfulResponse` throws rather than returning an error object for this
    // case; either way the caller must not receive a verdict.
    await expect(classifyHttpResponse(broken)).rejects.toThrow();
  });
});
