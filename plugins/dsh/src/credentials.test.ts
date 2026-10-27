/**
 * @test REQ-DSH-014 Delphi credential seam
 * @intent Verify the plugin can obtain the Delphi API key from DSH's credential store
 *         when the process environment does not carry it, and that resolution is
 *         single-layer — a store miss must not silently fall back to process.env.
 * @covers AC-DSH-014-01 AC-DSH-014-02 AC-DSH-014-03
 *
 * Why this exists: the machine that motivated this release has WHALECLOUD_API_KEY in
 * a user-level environment variable and in ~/.dsh/.credentials.yaml, but NOT in the
 * environment DSH's own process inherits. Every gate tool worked; delphi-review alone
 * failed with "missing WHALECLOUD_API_KEY". A plugin that installs, lists its skills,
 * and then cannot run its headline feature is the definition of incomplete.
 */

import { describe, it, expect } from "vitest"
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials"
import { createCredentialResolver } from "./credentials.js"

describe("createCredentialResolver", () => {
  it("resolves through the real CredentialRef the DSH service expects", async () => {
    // Guards against hand-built reference shapes: the service takes a branded ref,
    // so passing a plain object would type-check nowhere and fail at runtime.
    const seen: unknown[] = []
    const credentials = {
      async resolve(ref: unknown) {
        seen.push(ref)
        return { value: "key-from-store" }
      },
    }
    const resolve = createCredentialResolver(credentials, {}, (name) => credentialRef(name))
    await expect(resolve("WHALECLOUD_API_KEY")).resolves.toBe("key-from-store")
    expect(seen).toHaveLength(1)
    expect(isCredentialRefName(seen[0] as string)).toBe(true)
    expect(seen[0]).toBe(credentialRef("WHALECLOUD_API_KEY"))
  })
  it("returns the value stored in the DSH credential store", async () => {
    const calls: unknown[] = []
    const credentials = {
      async resolve(ref: unknown) {
        calls.push(ref)
        return { value: "key-from-store" }
      },
    }
    // Default brand is the identity, which is all a plain string-keyed fake needs.
    const resolve = createCredentialResolver(credentials, {})
    await expect(resolve("WHALECLOUD_API_KEY")).resolves.toBe("key-from-store")
    expect(calls).toEqual(["WHALECLOUD_API_KEY"])
  })

  it("does not fall back to process.env when the store answers undefined", async () => {
    // The store already layers env -> provider store -> .env. Re-reading env here
    // would resurrect a key the store deliberately reported as absent, and would
    // make a GUI session resolve differently from a terminal session.
    const credentials = { resolve: async () => undefined }
    const env = { WHALECLOUD_API_KEY: "key-from-env" }
    const resolve = createCredentialResolver(credentials, env)
    await expect(resolve("WHALECLOUD_API_KEY")).resolves.toBeUndefined()
  })

  it("uses process env only when no credential service is available", async () => {
    const resolve = createCredentialResolver(undefined, { WHALECLOUD_API_KEY: "key-from-env" })
    await expect(resolve("WHALECLOUD_API_KEY")).resolves.toBe("key-from-env")
  })

  it("returns undefined when neither source has the value", async () => {
    const resolve = createCredentialResolver(undefined, {})
    await expect(resolve("WHALECLOUD_API_KEY")).resolves.toBeUndefined()
  })

  it("ignores names that are not valid environment-variable identifiers", async () => {
    const credentials = {
      resolve: async () => {
        throw new Error("must not be called for an invalid ref")
      },
    }
    const resolve = createCredentialResolver(credentials, {})
    await expect(resolve("../etc/passwd")).resolves.toBeUndefined()
    await expect(resolve("")).resolves.toBeUndefined()
    await expect(resolve("has-dash")).resolves.toBeUndefined()
  })

  it("degrades to undefined when the credential store throws", async () => {
    // A broken store must not take the whole tool down; the caller reports a
    // named setup error instead.
    const credentials = {
      resolve: async () => {
        throw new Error("store unavailable")
      },
    }
    const resolve = createCredentialResolver(credentials, {})
    await expect(resolve("WHALECLOUD_API_KEY")).resolves.toBeUndefined()
  })
})
