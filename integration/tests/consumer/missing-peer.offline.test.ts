/**
 * What a consumer meets when a required peer is absent — which no other suite here can see.
 *
 * `packaged.test.ts` loads each entry by absolute path into `packages/<name>/`, so every peer
 * resolves from the monorepo's own `node_modules`. Its comment says the assertion exercises "every
 * peer the entry pulls at load time"; it exercises the bundle and its externals, and cannot
 * exercise a MISSING peer, because none is ever missing there. Filed separately.
 *
 * This file stages the layout that can: the built `dist` COPIED — never symlinked — into a fixture
 * whose `node_modules` holds React, `react-hook-form`, `zod` and `theokit`, and deliberately not
 * `@usetheo/ui`.
 *
 * `react-router` is staged too, and only because of where `useAction` lives. `theokit/client` is
 * the React entry, and it re-exports `Link`, which imports the router — so pulling one hook out of
 * that barrel pulls the router with it. A real consumer always has it (theokit declares it a
 * REQUIRED peer), but this fixture is a bare tmpdir with nothing above it to resolve from, which is
 * the whole point: it measures a consumer, not the monorepo.
 *
 * The copy is load-bearing. A first probe symlinked the package and reported a clean pass, because
 * Node resolves a symlink to its real path and resolution walked up into the monorepo — measuring
 * the monorepo while believing it measured a consumer.
 *
 * What it pins today is a DEFECT, deliberately: `@theokit/plugin-forms` documents a headless tier
 * usable "in any React stack", and its only entry point cannot be imported without the UI package.
 * When that becomes reachable this test fails, which is the correct signal and the reason to write
 * it as an assertion rather than a note.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readdirSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname
const created: string[] = []

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

/** Resolve a package out of the pnpm store by name prefix, so the fixture uses real installs. */
function storePath(prefix: string, inner: string): string | undefined {
  const store = join(REPO_ROOT, 'node_modules', '.pnpm')
  const dir = readdirSync(store).find((d) => d.startsWith(prefix))
  return dir === undefined ? undefined : join(store, dir, 'node_modules', inner)
}

/**
 * A consumer project holding `@theokit/plugin-forms` and the peers named in `peers`.
 *
 * The plugin's `dist` is COPIED. Everything else is symlinked, which is safe for them: they are
 * leaves here, and nothing about this test depends on where THEIR dependencies resolve.
 */
function consumer(peers: readonly (readonly [string, string])[]): string {
  const root = mkdtempSync(join(tmpdir(), 'missing-peer-'))
  created.push(root)
  writeFileSync(join(root, 'package.json'), '{"name":"probe","type":"module","private":true}')

  const target = join(root, 'node_modules', '@theokit', 'plugin-forms')
  mkdirSync(target, { recursive: true })
  for (const entry of ['dist', 'package.json']) {
    cpSync(join(REPO_ROOT, 'packages', 'plugin-forms', entry), join(target, entry), {
      recursive: true,
    })
  }

  for (const [prefix, name] of peers) {
    const from = storePath(prefix, name)
    if (from === undefined) continue
    const to = join(root, 'node_modules', name)
    mkdirSync(join(to, '..'), { recursive: true })
    symlinkSync(from, to)
  }
  return root
}

/** Every peer the barrel needs EXCEPT the one under test. */
const PEERS_WITHOUT_UI = [
  ['react@19', 'react'],
  ['react-dom@19', 'react-dom'],
  ['react-hook-form@', 'react-hook-form'],
  ['@hookform+resolvers@', '@hookform/resolvers'],
  // `theokit` since usetheokit/theokit#453: `useAction` moved into the framework, out of
  // `@theokit/react` — one published version, no repository, an unsatisfiable SDK peer.
  ['theokit@0.52', 'theokit'],
  ['react-router@', 'react-router'],
  ['zod@4', 'zod'],
] as const

/** Import the barrel from inside `root`, returning the error code when it fails. */
async function importBarrel(
  root: string,
): Promise<{ ok: boolean; code?: string; keys?: string[] }> {
  // Import by file URL into the fixture's own copy, so resolution starts there.
  const entry = pathToFileURL(
    join(root, 'node_modules', '@theokit', 'plugin-forms', 'dist', 'index.js'),
  ).href
  try {
    const mod = (await import(entry)) as Record<string, unknown>
    return { ok: true, keys: Object.keys(mod) }
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code }
  }
}

describe('@theokit/plugin-forms without @usetheo/ui', () => {
  it('cannot be imported at all — not "throws at first render"', async () => {
    const result = await importBarrel(consumer(PEERS_WITHOUT_UI))

    expect(
      result.ok,
      'the barrel loaded without @usetheo/ui — update this test and the README',
    ).toBe(false)
    expect(result.code).toBe('ERR_MODULE_NOT_FOUND')
  }, 60_000)

  it('imports once @usetheo/ui is present, which is what makes the test above about the peer', async () => {
    // The discriminating half. Without it, the assertion above would pass for any reason the
    // fixture failed to load — a missing React, a bad copy, a wrong path.
    const root = consumer([...PEERS_WITHOUT_UI, ['@usetheo+ui@', '@usetheo/ui']])

    const result = await importBarrel(root)

    expect(result.ok, 'the fixture is broken for a reason unrelated to the peer').toBe(true)
    expect(result.keys).toContain('useTheoField')
  }, 60_000)
})
