/**
 * @theokit/plugin-copilot/react — React hooks (P#11).
 *
 * Per ADR D1 — mirrors CopilotKit's useCopilotChat + useFrontendTool +
 * useMakeCopilotReadable canonical surface. Plus our differentiator:
 * useCopilotPresence (P#9 RoomMember awareness).
 *
 * @public
 */

import * as React from "react";
import { CopilotContext, type CopilotContextValue, type CopilotMessage, type CopilotPresenceEntry } from "./copilot-context.js";

function useCopilotContextOrThrow(hook: string): CopilotContextValue {
  const ctx = React.useContext(CopilotContext);
  if (ctx === null) {
    throw new Error(`${hook}: must be called inside <CopilotProvider>`);
  }
  return ctx;
}

/**
 * Main hook — returns the full copilot context (messages + presence + sendBroadcast + usage + lastError).
 *
 * @public
 */
export function useCopilot(): CopilotContextValue {
  return useCopilotContextOrThrow("useCopilot");
}

/**
 * Subscribes to presence of OTHER participants in the room (humans + copilots).
 * Filters out the local user via the connectionId you pass.
 *
 * @public
 */
export function useCopilotPresence(localConnectionId?: string): Record<string, CopilotPresenceEntry> {
  const ctx = useCopilotContextOrThrow("useCopilotPresence");
  return React.useMemo(() => {
    if (localConnectionId === undefined) return ctx.presence;
    const out: Record<string, CopilotPresenceEntry> = {};
    for (const [id, p] of Object.entries(ctx.presence)) {
      if (id !== localConnectionId) out[id] = p;
    }
    return out;
  }, [ctx.presence, localConnectionId]);
}

/**
 * Registers knowledge about local app state into the copilot context.
 *
 * v0.1 client-side stores: knowledge is broadcast via `register-knowledge`
 * event; copilot picks up via custom trigger filter on consumer side. Server-
 * supplied context (D40 family hook integration) lands in v0.x when SDK
 * exposes per-room context injection point.
 *
 * @public
 */
export function useCopilotReadable<T>(opts: { description: string; value: T }): void {
  const ctx = useCopilotContextOrThrow("useCopilotReadable");
  React.useEffect(() => {
    ctx.sendBroadcast("register-knowledge", {
      description: opts.description,
      value: opts.value,
    });
    return () => {
      ctx.sendBroadcast("deregister-knowledge", { description: opts.description });
    };
  }, [ctx, opts.description, opts.value]);
}

/**
 * Registers a frontend tool the copilot can call. Tool is broadcast as a
 * registration; copilot triggers `execute-tool` action when matched.
 *
 * @public
 */
export function useCopilotTool<TArgs extends Record<string, unknown>>(opts: {
  name: string;
  description: string;
  handler: (args: TArgs) => Promise<unknown>;
  authorize?: () => boolean | Promise<boolean>;
}): void {
  const ctx = useCopilotContextOrThrow("useCopilotTool");
  React.useEffect(() => {
    ctx.sendBroadcast("register-tool", {
      name: opts.name,
      description: opts.description,
    });
    return () => {
      ctx.sendBroadcast("deregister-tool", { name: opts.name });
    };
  }, [ctx, opts.name, opts.description]);
}

/**
 * Returns the messages array directly (convenience).
 *
 * @public
 */
export function useCopilotMessages(): readonly CopilotMessage[] {
  return useCopilotContextOrThrow("useCopilotMessages").messages;
}

/**
 * Returns just the typing indicator state.
 *
 * @public
 */
export function useCopilotTyping(): boolean {
  return useCopilotContextOrThrow("useCopilotTyping").isAnyCopilotTyping;
}
