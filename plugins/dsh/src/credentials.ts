/**
 * Resolve the API key that a Delphi provider config points at, without assuming the
 * value is in this process's environment.
 *
 * The credential service shipped with DSH layers environment, a provider-managed
 * store, and `.env` files behind one `CredentialRef`. That is exactly the order the
 * plugin needs: on the machine that prompted this work the key lived in a user-level
 * environment variable and in `~/.dsh/.credentials.yaml`, while DSH's own process
 * inherited neither — so `delphi-review` failed with a missing-variable error while
 * every other gate worked.
 *
 * Resolution is deliberately single-layer. When `ctx.credentials` is present and
 * reports `undefined`, this module does NOT fall back to `process.env`: the service
 * has already consulted the environment, so a second look would resurrect a value it
 * deliberately reported as absent and would make a DSH session resolve differently
 * from a terminal session.
 */

/** A credential service, narrowed to the one method this module needs. */
export interface CredentialService {
  resolve(ref: unknown): Promise<{ value: string } | undefined>
}

/** Resolve one environment-variable-style reference to its current value. */
export type ApiKeyResolver = (ref: string) => Promise<string | undefined>

/**
 * Environment-variable names: a POSIX shell identifier. Anything else cannot name a
 * credential, so it reads as "not set" rather than reaching the store.
 */
const REFERENCE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function isReferenceName(value: string): boolean {
  return REFERENCE_NAME.test(value)
}

/**
 * Build an `ApiKeyResolver` over the available credential service.
 *
 * @param credentials - `ctx.credentials`, or undefined when the host does not offer
 *   one. Absence degrades to reading the process environment directly, which keeps
 *   the plugin working outside DSH (CLI use, tests).
 * @param env - environment to read in that fallback. Injected rather than read from
 *   the global so the module stays testable offline.
 * @param brand - converts a raw name into the service's nominal `CredentialRef`.
 *   Injected so this module needs no import of the peer package and tests can pass
 *   an identity function.
 */
export function createCredentialResolver(
  credentials: CredentialService | undefined,
  env: NodeJS.ProcessEnv,
  brand: (value: string) => unknown = (value) => value,
): ApiKeyResolver {
  return async (ref: string): Promise<string | undefined> => {
    if (!isReferenceName(ref)) return undefined

    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(brand(ref))
        return resolved?.value
      } catch {
        // A broken provider must not take the tool down; the caller turns the
        // missing value into a DelphiSetupError that names the variable.
        return undefined
      }
    }

    const value = env[ref]
    return typeof value === "string" && value.length > 0 ? value : undefined
  }
}
