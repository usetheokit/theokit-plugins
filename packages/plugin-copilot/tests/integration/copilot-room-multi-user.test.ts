/**
 * P#11 T4.1 — REAL multi-user copilot-as-RoomMember integration.
 *
 * Mirrors the canonical P#9 multi-client presence pattern
 * (`plugin-realtime/tests/integration/presence-multi-client.test.ts`) but
 * exercises the copilot SIDE: one human user + one copilot in the same room,
 * user broadcasts a question, copilot responds via the full Agent loop, and
 * the human's frame listener sees the copilot's typed broadcast frames.
 *
 * The "agent" here is a deterministic AsyncIterable that mimics SDK
 * `Agent.streamObject` semantics (partial chunks → complete) WITHOUT calling
 * an LLM. Real-LLM end-to-end lives in `copilot-real-llm.test.ts` env-gated
 * by `OPENROUTER_API_KEY`.
 *
 * Validates the full chain:
 *   1. Provider fans frames to ALL room listeners (alice, copilot runtime).
 *   2. Copilot connectionId is `copilot:<id>` — distinguishable from human.
 *   3. Copilot broadcasts typing-on → message → typing-off, all visible to alice.
 *   4. EC-4/EC-8: alice's own broadcast doesn't trigger HER own copilot's response.
 *   5. EC-4/EC-8: a frame from `copilot:other` does NOT loop back into this copilot.
 */
import { describe, expect, it } from "vitest";
import { defineCopilot } from "../../src/define-copilot.js";
import { CopilotRuntime } from "../../src/internal/runtime.js";
import type {
  CopilotAgentLike,
  CopilotFrame,
  CopilotRealtimeProvider,
} from "../../src/types.js";

const passthroughSchema = {
  safeParse: (v: unknown) => ({ success: true as const, data: v }),
};

interface InMemoryProvider extends CopilotRealtimeProvider {
  emit(roomId: string, frame: CopilotFrame): void;
  joins: { roomId: string; connectionId: string; presence?: Record<string, unknown> }[];
  broadcasts: {
    roomId: string;
    connectionId: string;
    event: string;
    payload: Record<string, unknown>;
  }[];
  presenceUpdates: {
    roomId: string;
    connectionId: string;
    patch: Record<string, unknown>;
  }[];
}

function makeProvider(): InMemoryProvider {
  const subs = new Map<string, Set<(f: CopilotFrame) => void>>();
  const presences = new Map<string, Map<string, Record<string, unknown>>>();
  const provider: InMemoryProvider = {
    joins: [],
    broadcasts: [],
    presenceUpdates: [],
    async joinRoom(roomId, conn, initialPresence) {
      provider.joins.push({ roomId, connectionId: conn.connectionId, presence: initialPresence });
      const room = presences.get(roomId) ?? new Map();
      room.set(conn.connectionId, initialPresence ?? {});
      presences.set(roomId, room);
      // Fanout the join frame — mirrors P#9 MemoryRealtimeProvider behaviour.
      provider.emit(roomId, {
        type: "joined",
        connectionId: conn.connectionId,
        presence: initialPresence ?? {},
      });
    },
    async leaveRoom(roomId, connectionId) {
      presences.get(roomId)?.delete(connectionId);
      provider.emit(roomId, { type: "left", connectionId });
    },
    async broadcast(roomId, connectionId, event, payload) {
      provider.broadcasts.push({ roomId, connectionId, event, payload });
      provider.emit(roomId, { type: "broadcast", connectionId, event, payload });
    },
    async updatePresence(roomId, connectionId, patch) {
      provider.presenceUpdates.push({ roomId, connectionId, patch });
      const room = presences.get(roomId);
      const cur = room?.get(connectionId) ?? {};
      const merged = { ...cur, ...patch };
      room?.set(connectionId, merged);
      provider.emit(roomId, { type: "presence-changed", connectionId, presence: merged });
    },
    async getPresence(roomId) {
      const room = presences.get(roomId);
      if (room === undefined) return {};
      const out: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of room) out[k] = v;
      return out;
    },
    subscribeRoom(roomId, listener) {
      const set = subs.get(roomId) ?? new Set();
      set.add(listener);
      subs.set(roomId, set);
      return () => set.delete(listener);
    },
    emit(roomId, frame) {
      const set = subs.get(roomId);
      if (set === undefined) return;
      for (const cb of set) cb(frame);
    },
  };
  return provider;
}

function makeDeterministicAgent(text: string): CopilotAgentLike {
  return {
    async *streamObject<T>() {
      // Two partial chunks + final complete — mirrors typical SDK streamObject shape.
      yield { type: "partial", partial: { text: text.slice(0, 5) } as unknown as T, attempt: 0 };
      yield { type: "partial", partial: { text } as unknown as T, attempt: 0 };
      yield { type: "complete", object: { text } as unknown as T };
    },
  };
}

describe("P#11 T4.1 — copilot as RoomMember (multi-user integration)", () => {
  it("alice asks a question and a copilot in the same room responds with full frame chain", async () => {
    const provider = makeProvider();

    const copilot = defineCopilot({
      id: "assistant",
      room: { id: "support-room", presence: passthroughSchema, broadcast: passthroughSchema },
      agent: {
        name: "SupportBot",
        model: "openrouter/openai/gpt-4o-mini",
        systemPrompt: "You are SupportBot.",
      },
      identity: { name: "Support Bot", color: "#7c3aed" },
      triggers: [{ on: "broadcast:question", action: "respond" }],
    });

    const rt = new CopilotRuntime({
      provider,
      agent: makeDeterministicAgent("Hello Alice, I can help with that."),
      copilots: [copilot],
    });

    // Alice is a HUMAN client — listens to room frames directly.
    const aliceFrames: CopilotFrame[] = [];
    const unsubAlice = provider.subscribeRoom("support-room", (f) => aliceFrames.push(f));
    await provider.joinRoom("support-room", { connectionId: "alice" }, { name: "Alice" });

    // Activate the copilot — it joins as `copilot:assistant`.
    await rt.activate("assistant");

    // Alice should have seen the copilot join via the joined frame.
    const copilotJoined = aliceFrames.find(
      (f) => f.type === "joined" && f.connectionId === "copilot:assistant",
    );
    expect(copilotJoined).toBeDefined();
    expect((copilotJoined as { presence: Record<string, unknown> }).presence.name).toBe(
      "Support Bot",
    );
    expect((copilotJoined as { presence: Record<string, unknown> }).presence.isCopilot).toBe(true);

    // Alice broadcasts a question.
    await provider.broadcast("support-room", "alice", "question", {
      text: "How do I reset my password?",
    });

    // Wait for async runAgent loop.
    await new Promise((r) => setTimeout(r, 60));

    // Alice should have seen: typing on → message broadcast → typing off.
    const typingOn = aliceFrames.find(
      (f) =>
        f.type === "presence-changed" &&
        (f as { connectionId: string }).connectionId === "copilot:assistant" &&
        (f as { presence: Record<string, unknown> }).presence.typing === true,
    );
    const messageBroadcast = aliceFrames.find(
      (f) =>
        f.type === "broadcast" &&
        (f as { connectionId: string }).connectionId === "copilot:assistant" &&
        (f as { event: string }).event === "message",
    );
    const typingOff = aliceFrames.find(
      (f) =>
        f.type === "presence-changed" &&
        (f as { connectionId: string }).connectionId === "copilot:assistant" &&
        (f as { presence: Record<string, unknown> }).presence.typing === false,
    );

    expect(typingOn).toBeDefined();
    expect(messageBroadcast).toBeDefined();
    expect(typingOff).toBeDefined();
    expect(
      (messageBroadcast as { payload: Record<string, unknown> }).payload.text,
    ).toBe("Hello Alice, I can help with that.");
    expect(
      (messageBroadcast as { payload: Record<string, unknown> }).payload.role,
    ).toBe("assistant");
    expect(
      (messageBroadcast as { payload: Record<string, unknown> }).payload.copilotId,
    ).toBe("assistant");

    // Presence snapshot includes both alice + copilot.
    const snapshot = await provider.getPresence("support-room");
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining(["alice", "copilot:assistant"]),
    );
    expect(snapshot["copilot:assistant"]!.isCopilot).toBe(true);

    unsubAlice();
    await rt.unregisterCopilot("assistant");
  });

  it("EC-4/EC-8: another copilot's broadcast does NOT trigger this copilot (cost-runaway guard)", async () => {
    const provider = makeProvider();
    let invocationCount = 0;
    const copilot = defineCopilot({
      id: "watcher",
      room: { id: "war-room", presence: passthroughSchema, broadcast: passthroughSchema },
      agent: { name: "Watcher", model: "openrouter/openai/gpt-4o-mini" },
      identity: { name: "Watcher Bot" },
      triggers: [{ on: "broadcast:any-event", action: "respond" }],
    });

    const trackedAgent: CopilotAgentLike = {
      async *streamObject<T>() {
        invocationCount++;
        yield { type: "complete", object: { text: "should not loop" } as unknown as T };
      },
    };

    const rt = new CopilotRuntime({ provider, agent: trackedAgent, copilots: [copilot] });
    await rt.activate("watcher");

    // Simulate a frame originating from ANOTHER copilot (different id).
    provider.emit("war-room", {
      type: "broadcast",
      connectionId: "copilot:other-bot",
      event: "any-event",
      payload: { text: "trying to trigger infinite loop" },
    });
    // Also try a frame from ITSELF (the same `copilot:watcher` connectionId).
    provider.emit("war-room", {
      type: "broadcast",
      connectionId: "copilot:watcher",
      event: "any-event",
      payload: { text: "echo of own broadcast" },
    });

    await new Promise((r) => setTimeout(r, 40));

    expect(invocationCount).toBe(0); // EC-4/EC-8 guard held — no infinite loop.

    await rt.unregisterCopilot("watcher");
  });

  it("two humans + one copilot: copilot responds to either user", async () => {
    const provider = makeProvider();
    const copilot = defineCopilot({
      id: "helper",
      room: { id: "chat-room", presence: passthroughSchema, broadcast: passthroughSchema },
      agent: { name: "Helper", model: "openrouter/openai/gpt-4o-mini" },
      identity: { name: "Helper" },
      triggers: [{ on: "broadcast:ask", action: "respond" }],
    });
    const rt = new CopilotRuntime({
      provider,
      agent: makeDeterministicAgent("Here is the answer."),
      copilots: [copilot],
    });

    await provider.joinRoom("chat-room", { connectionId: "alice" });
    await provider.joinRoom("chat-room", { connectionId: "bob" });
    await rt.activate("helper");

    // Alice asks.
    await provider.broadcast("chat-room", "alice", "ask", { text: "Q1?" });
    await new Promise((r) => setTimeout(r, 40));

    let copilotMessages = provider.broadcasts.filter(
      (b) => b.connectionId === "copilot:helper" && b.event === "message",
    );
    expect(copilotMessages).toHaveLength(1);

    // Bob asks.
    await provider.broadcast("chat-room", "bob", "ask", { text: "Q2?" });
    await new Promise((r) => setTimeout(r, 40));

    copilotMessages = provider.broadcasts.filter(
      (b) => b.connectionId === "copilot:helper" && b.event === "message",
    );
    expect(copilotMessages).toHaveLength(2);

    await rt.unregisterCopilot("helper");
  });
});
