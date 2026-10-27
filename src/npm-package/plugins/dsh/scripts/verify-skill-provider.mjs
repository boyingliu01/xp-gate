/**
 * @test REQ-DSH-006
 * @intent INV-2 end-to-end: drive DSH's REAL SkillRegistry (not a fake), mount the
 *         xp-gate plugin through its own apply(), and assert the registry surfaces
 *         all 12 bundled skills with non-empty bodies and resolvable resource bases.
 * @covers AC-DSH-006-04
 *
 * Why this exists: every unit test asserts the provider's internal contract. None
 * prove the registry actually receives and ranks the skills. v1 shipped 65 files
 * and passed its own tests while the model saw nothing, so this script uses
 * @deepseek-ai/dsh-skill's SkillRegistry itself as the consumer.
 *
 * Usage: node scripts/verify-skill-provider.mjs <pluginDir>
 */

import { pathToFileURL } from "node:url"
import { join } from "node:path"

const EXPECTED = 12

/**
 * Build a real Cordis Context and mount the DSH SkillRegistry service on it.
 *
 * SkillRegistry extends cordis' Service, whose constructor reflects into the
 * owning context — a plain object literal cannot host it. Cordis also rejects
 * assigning undeclared properties, so the tools/shell seams are installed by a
 * small plugin that declares them the way a real DSH service would.
 */
async function makeContext(dshRoot, SkillRegistry) {
  const cordis = await import(
    pathToFileURL(join(dshRoot, "@deepseek-ai", "cordis", "lib", "index.js")).href
  )
  const ctx = new cordis.Context()
  const tools = []

  const seams = {
    name: "verify-seams",
    apply(scope) {
      scope.provide("tools", { register: (tool) => tools.push(tool) })
      scope.provide("shell", {
        resolve: (request) => ({ ...request }),
        execute: () => Promise.resolve({ result: () => Promise.resolve({}) }),
      })
    },
  }

  ctx.plugin(seams)
  // SkillRegistry is a Service; mounting it provides ctx.skills.
  await ctx.plugin(SkillRegistry)
  return { ctx, tools }
}

export async function verifySkillProvider(pluginDir, dshRoot) {
  const skillModule = await import(
    pathToFileURL(join(dshRoot, "@deepseek-ai", "dsh-skill", "lib", "index.js")).href
  )
  const { SkillRegistry } = skillModule

  const plugin = await import(pathToFileURL(join(pluginDir, "lib", "index.js")).href)
  const { ctx, tools } = await makeContext(dshRoot, SkillRegistry)

  const failures = []
  if (!Array.isArray(plugin.inject) || !plugin.inject.includes("skills")) {
    failures.push(`inject does not declare skills: ${JSON.stringify(plugin.inject)}`)
  }

  plugin.apply(ctx)

  // Registry-level view: exactly what a model-facing consumer would read.
  const summaries = await ctx.skills.list({ cwd: pluginDir })
  const ours = summaries.filter((s) => s.provider === "xp-gate")
  if (ours.length !== EXPECTED) {
    failures.push(`registry lists ${ours.length} xp-gate skills, expected ${EXPECTED}`)
  }

  const loaded = []
  for (const summary of ours) {
    const definition = await ctx.skills.get(summary.name, { cwd: pluginDir })
    if (!definition) {
      failures.push(`${summary.name}: not loadable through the registry`)
      continue
    }
    if (!definition.content || definition.content.trim().length === 0) {
      failures.push(`${summary.name}: empty body`)
      continue
    }
    if (definition.resourceBase?.kind !== "directory") {
      failures.push(`${summary.name}: resourceBase is ${JSON.stringify(definition.resourceBase)}`)
    }
    loaded.push({ name: summary.name, bytes: definition.content.length })
  }

  return {
    ok: failures.length === 0,
    reason: failures.join("; "),
    tools: tools.map((t) => t?.name).filter(Boolean),
    count: ours.length,
    loaded,
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const pluginDir = process.argv[2]
  const dshRoot = process.argv[3] ?? join(pluginDir, "node_modules")
  if (!pluginDir) {
    console.error("usage: node scripts/verify-skill-provider.mjs <pluginDir> [dshNodeModulesRoot]")
    process.exit(2)
  }
  const result = await verifySkillProvider(pluginDir, dshRoot)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
