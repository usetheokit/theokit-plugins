/**
 * @vitest-environment jsdom
 *
 * T4.5 — useCanvas state machine + optimistic publish flow.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CanvasPluginError } from '../src/errors.js'
import { useCanvas } from '../src/ui/use-canvas.js'
import type { Artifact } from '../src/schema.js'

const env = {
  id: 'art-1',
  title: 'My drawing',
  version: 1,
  createdAt: '2026-05-29T00:00:00Z',
}

const md = (overrides: Partial<Artifact> = {}): Artifact =>
  ({
    ...env,
    kind: 'markdown',
    content: '# hello',
    ...overrides,
  }) as Artifact

describe('useCanvas — initial state', () => {
  it('starts empty / closed', () => {
    const { result } = renderHook(() => useCanvas())
    expect(result.current.current).toBeNull()
    expect(result.current.history).toEqual([])
    expect(result.current.versions).toEqual([])
    expect(result.current.open).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('seeds with initialArtifacts (history + versions)', () => {
    const a = md()
    const { result } = renderHook(() => useCanvas({ initialArtifacts: [a] }))
    expect(result.current.history).toHaveLength(1)
    expect(result.current.current).toBeNull() // not selected unless show() called
  })
})

describe('useCanvas — show()', () => {
  it('sets current + opens the panel when autoOpen=true (default)', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md()))
    expect(result.current.current?.id).toBe('art-1')
    expect(result.current.open).toBe(true)
  })

  it('does NOT auto-open when autoOpen=false', () => {
    const { result } = renderHook(() => useCanvas({ autoOpen: false }))
    act(() => result.current.show(md()))
    expect(result.current.open).toBe(false)
  })

  it('multiple show() calls of the same id append versions', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md({ version: 1 })))
    act(() => result.current.show(md({ version: 2 })))
    act(() => result.current.show(md({ version: 3 })))
    expect(result.current.versions.map((a) => a.version)).toEqual([1, 2, 3])
    expect(result.current.current?.version).toBe(3)
  })

  it('selectVersion() switches to an older version without re-fetching', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md({ version: 1, content: 'a' })))
    act(() => result.current.show(md({ version: 2, content: 'b' })))
    act(() => result.current.selectVersion('art-1', 1))
    if (result.current.current?.kind === 'markdown') {
      expect(result.current.current.content).toBe('a')
    }
  })
})

describe('useCanvas — hide / setOpen', () => {
  it('hide() closes', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md()))
    expect(result.current.open).toBe(true)
    act(() => result.current.hide())
    expect(result.current.open).toBe(false)
  })

  it('setOpen toggles without losing current', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md()))
    act(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
    expect(result.current.current).not.toBeNull()
    act(() => result.current.setOpen(true))
    expect(result.current.open).toBe(true)
  })
})

describe('useCanvas — publish (local only)', () => {
  it('updates state when endpoint is omitted (no network)', async () => {
    const { result } = renderHook(() => useCanvas())
    let returned: Artifact | undefined
    await act(async () => {
      returned = await result.current.publish(md())
    })
    expect(returned?.id).toBe('art-1')
    expect(result.current.current?.id).toBe('art-1')
  })

  it('rejects + records error for an invalid artifact', async () => {
    const { result } = renderHook(() => useCanvas())
    let threw = false
    await act(async () => {
      try {
        // missing title
        await result.current.publish({
          id: 'a',
          kind: 'markdown',
          content: 'x',
        } as unknown as Artifact)
      } catch {
        threw = true
      }
    })
    expect(threw).toBe(true)
    expect(result.current.error).not.toBeNull()
  })
})

describe('useCanvas — publish (with endpoint)', () => {
  it('POSTs JSON with the CSRF default header, optimistic-inserts, then replaces with server response', async () => {
    let capturedInit: RequestInit | undefined
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      const serverShape: Artifact = { ...md(), version: 7 }
      return Promise.resolve(
        new Response(JSON.stringify({ artifact: serverShape }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    const { result } = renderHook(() => useCanvas({ endpoint: '/api/canvas/artifacts', fetchImpl }))
    await act(async () => {
      await result.current.publish(md())
    })
    expect(capturedInit?.method).toBe('POST')
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>
    expect(headers['X-Theo-Action']).toBe('1')
    expect(result.current.current?.version).toBe(7)
  })

  it('rolls back the optimistic insert on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('Unauthorized', { status: 401 })))
    const { result } = renderHook(() => useCanvas({ endpoint: '/api/canvas/artifacts', fetchImpl }))
    let threw = false
    await act(async () => {
      try {
        await result.current.publish(md())
      } catch {
        threw = true
      }
    })
    expect(threw).toBe(true)
    expect(result.current.current).toBeNull()
    expect(result.current.error).toBeInstanceOf(CanvasPluginError)
  })

  it('omits CSRF header when csrfHeader=null', async () => {
    let capturedInit: RequestInit | undefined
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return Promise.resolve(new Response(JSON.stringify({ artifact: md() }), { status: 200 }))
    })
    const { result } = renderHook(() =>
      useCanvas({ endpoint: '/api/canvas/artifacts', fetchImpl, csrfHeader: null }),
    )
    await act(async () => {
      await result.current.publish(md())
    })
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>
    expect(headers['X-Theo-Action']).toBeUndefined()
  })

  it('accepts a server response without an `artifact` envelope', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(md()), { status: 200 })),
    )
    const { result } = renderHook(() => useCanvas({ endpoint: '/api/canvas/artifacts', fetchImpl }))
    await act(async () => {
      await result.current.publish(md())
    })
    expect(result.current.current?.id).toBe('art-1')
  })
})

describe('useCanvas — fork', () => {
  it('forks onto a new id by default + opens the fork', async () => {
    const { result } = renderHook(() => useCanvas())
    await act(async () => {
      await result.current.fork(md(), { title: 'forked' })
    })
    expect(result.current.current?.title).toBe('forked')
    expect(result.current.current?.id).not.toBe('art-1')
    expect(result.current.current?.version).toBe(1)
  })

  it('forks onto same id when overrides.id is provided', async () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md({ version: 1 })))
    await act(async () => {
      await result.current.fork(md({ version: 1 }), { id: 'art-1', version: 2, content: '# v2' })
    })
    expect(result.current.versions.map((a) => a.version)).toEqual([1, 2])
  })
})

describe('useCanvas — remove', () => {
  it('removes a specific version', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md({ version: 1 })))
    act(() => result.current.show(md({ version: 2 })))
    act(() => result.current.remove('art-1', 1))
    expect(result.current.versions.map((a) => a.version)).toEqual([2])
  })

  it('removing all versions clears the pointer', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show(md()))
    act(() => result.current.remove('art-1'))
    expect(result.current.current).toBeNull()
  })
})

describe('useCanvas — derived selectors', () => {
  it('history is sorted by createdAt descending', () => {
    const { result } = renderHook(() => useCanvas())
    act(() => result.current.show({ ...md({ id: 'a', createdAt: '2026-05-29T00:00:01Z' }) }))
    act(() => result.current.show({ ...md({ id: 'b', createdAt: '2026-05-29T00:00:02Z' }) }))
    expect(result.current.history.map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('versions is empty when pointer is null', () => {
    const { result } = renderHook(() => useCanvas())
    expect(result.current.versions).toEqual([])
  })
})
