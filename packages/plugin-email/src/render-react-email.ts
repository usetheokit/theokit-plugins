/**
 * @theokit/plugin-email — React Email render bridge.
 *
 * Per plan p7-plugin-email v1.0 § Phase 2 / T2.2.
 * Blueprint ADR D3 — React Email is OPTIONAL peer; dynamic import keeps
 * zero-cost path for consumers writing plain HTML strings.
 */

/**
 * Render a React Email component to HTML using the consumer's installed
 * `@react-email/render` peer.
 *
 * Throws an actionable error when the peer is not installed.
 *
 * Note: the `component` parameter is typed as `unknown` here to avoid an
 * unconditional `react` import. Consumers pass a `React.ReactElement` — the
 * type is enforced by the React Email peer at consumer call-site.
 *
 * ```ts
 * import { renderReactEmail } from "@theokit/plugin-email";
 * import { Html, Heading } from "@react-email/components";
 *
 * const html = await renderReactEmail(<Html><Heading>Hi</Heading></Html>);
 * ```
 */
export async function renderReactEmail(component: unknown): Promise<string> {
  let mod: { render: (el: unknown) => Promise<string> }
  try {
    // @ts-expect-error — @react-email/render is an OPTIONAL peer (ADR D3).
    // Types intentionally absent in plugin-email's deps; consumer installs
    // the peer at runtime. Falls into the catch block when missing.
    mod = (await import('@react-email/render')) as {
      render: (el: unknown) => Promise<string>
    }
  } catch (cause) {
    throw new Error(
      '@react-email/render not installed. Run `pnpm add @react-email/render @react-email/components react` to use React Email templates.',
      { cause },
    )
  }
  return mod.render(component)
}
