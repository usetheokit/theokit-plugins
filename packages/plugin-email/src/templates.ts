/**
 * @theokit/plugin-email — typed email template factory.
 *
 * Per plan p7-plugin-email v1.0 § Phase 2 / T2.1.
 */

/** Rendered template output — plain content ready to ship via EmailProvider. */
export interface RenderedTemplate {
  readonly subject: string
  readonly html: string
  readonly text?: string
}

/** Descriptor returned by `defineEmailTemplate`. */
export interface EmailTemplate<T = void> {
  readonly name: string
  render: (props: T) => Promise<RenderedTemplate>
}

/**
 * Define a typed email template — a function that takes props and returns
 * `{subject, html, text?}`. Consumers compose templates from React Email
 * components (via `renderReactEmail`) or plain HTML strings.
 *
 * ```ts
 * import { defineEmailTemplate } from "@theokit/plugin-email";
 *
 * export const welcomeTemplate = defineEmailTemplate("welcome", async (props: {name: string}) => ({
 *   subject: `Welcome, ${props.name}`,
 *   html: `<h1>Hello ${props.name}</h1>`,
 *   text: `Hello ${props.name}`,
 * }));
 * ```
 */
export function defineEmailTemplate<T = void>(
  name: string,
  render: (props: T) => Promise<RenderedTemplate>,
): EmailTemplate<T> {
  return { name, render }
}
