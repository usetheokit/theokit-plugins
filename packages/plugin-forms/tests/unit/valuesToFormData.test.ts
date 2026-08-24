/**
 * The convention is not ours — it is `theokit`'s, and it is not the obvious one.
 *
 * Its reconstruction (`formDataToObject`) prefix-scans for `parent.` to find nested objects and
 * calls `formData.getAll(key)` for arrays. So an array is REPEATED KEYS, never `tags[0]`/`tags[1]`.
 * A hand-rolled walk naturally produces the bracket form — the probe that measured this wrote it
 * that way without thinking — and `getAll('tags')` then finds nothing: the array arrives EMPTY,
 * with no error anywhere. That silent shape is why this is a shipped function and not a README
 * snippet.
 *
 * `tests/integration/multipart-round-trip.test.ts` is what keeps this file honest: it runs the real
 * reconstruction, so a divergence fails here rather than in a consumer's upload.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { valuesToFormData } from '../../src/adapter/valuesToFormData.js'

describe('the array convention', () => {
  it('emits one repeated key per element, never an indexed one', () => {
    // The silent failure, first. `getAll('tags')` on `tags[0]`/`tags[1]` returns [].
    const schema = z.object({ tags: z.array(z.string()) })
    const fd = valuesToFormData({ tags: ['a', 'b'] }, schema)

    expect(fd.getAll('tags')).toEqual(['a', 'b'])
    expect(fd.getAll('tags[0]'), 'an indexed key would reconstruct as an empty array').toEqual([])
  })

  it('emits no key for an empty array rather than an empty string', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const fd = valuesToFormData({ tags: [] }, schema)

    expect(fd.has('tags')).toBe(false)
  })
})

describe('nesting', () => {
  it('emits dot notation, which is what the reconstruction prefix-scans for', () => {
    const schema = z.object({ user: z.object({ name: z.string(), age: z.number() }) })
    const fd = valuesToFormData({ user: { name: 'ana', age: 30 } }, schema)

    expect(fd.get('user.name')).toBe('ana')
    expect(fd.get('user.age')).toBe('30')
  })

  it('emits no key for an absent optional field', () => {
    const schema = z.object({ title: z.string(), note: z.string().optional() })
    const fd = valuesToFormData({ title: 't' }, schema)

    expect(fd.has('note')).toBe(false)
  })
})

describe('files', () => {
  it('emits one key per file, with the blob intact', async () => {
    const schema = z.object({ docs: z.array(z.instanceof(File)) })
    const a = new File(['first'], 'a.txt', { type: 'text/plain' })
    const b = new File(['second'], 'b.txt', { type: 'text/plain' })

    const fd = valuesToFormData({ docs: [a, b] }, schema)
    const got = fd.getAll('docs') as File[]

    expect(got).toHaveLength(2)
    // The bytes, not the name. `JSON.stringify(file)` keeps `{name, type, lastModified}` and drops
    // the content, so a name-only assertion passes against the very defect this exists to fix.
    expect(await got[0]!.text()).toBe('first')
    expect(await got[1]!.text()).toBe('second')
  })

  it('unwraps an array-like that is not an Array', async () => {
    // The browser hands RHF a `FileList`: array-like, not an `Array`. This test environment CANNOT
    // produce one — measured, happy-dom's `DataTransfer.files` is itself an `Array` — so branching
    // on `Array.isArray` would pass every test here and fail in the only place that matters.
    // Nothing in this repository can observe the real shape; the converter accepts both instead.
    const schema = z.object({ docs: z.array(z.instanceof(File)) })
    const file = new File(['only'], 'a.txt')
    const fileListLike = { 0: file, length: 1 } as unknown as File[]

    const fd = valuesToFormData({ docs: fileListLike }, schema)
    const got = fd.getAll('docs') as File[]

    expect(got).toHaveLength(1)
    expect(await got[0]!.text()).toBe('only')
  })

  it('emits no key when nothing was selected', () => {
    const schema = z.object({ docs: z.array(z.instanceof(File)) })
    const empty = { length: 0 } as unknown as File[]

    const fd = valuesToFormData({ docs: empty }, schema)

    expect(fd.has('docs'), 'an empty selection became a zero-byte nameless file').toBe(false)
  })

  it('carries a single-file field as one repeated key', async () => {
    const schema = z.object({ doc: z.instanceof(File) })
    const file = new File(['solo'], 'a.txt')

    const fd = valuesToFormData({ doc: file }, schema)

    expect(await (fd.get('doc') as File).text()).toBe('solo')
  })
})

describe('scalars the reconstruction coerces back', () => {
  it('emits booleans as the strings it parses', () => {
    const schema = z.object({ agreed: z.boolean(), declined: z.boolean() })
    const fd = valuesToFormData({ agreed: true, declined: false }, schema)

    // `coerceBoolean` reads 'true'/'false' literally; anything else becomes `Boolean(value)`, which
    // makes the string "false" come back as `true`.
    expect(fd.get('agreed')).toBe('true')
    expect(fd.get('declined')).toBe('false')
  })

  it('emits numbers as strings, which the reconstruction turns back into numbers', () => {
    const schema = z.object({ qty: z.number() })
    const fd = valuesToFormData({ qty: 7 }, schema)

    expect(fd.get('qty')).toBe('7')
  })

  it('walks through optional and default wrappers to find the real validator', () => {
    // `unwrapWrappers` on the other side does this; a converter that stops at ZodOptional would
    // treat an optional array as a scalar and emit one comma-joined key.
    const schema = z.object({ tags: z.array(z.string()).optional() })
    const fd = valuesToFormData({ tags: ['x', 'y'] }, schema)

    expect(fd.getAll('tags')).toEqual(['x', 'y'])
  })
})
