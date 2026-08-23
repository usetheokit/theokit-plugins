---
'@theokit/plugin-copilot': minor
---

`<CopilotChat />` no longer lists the local user among the other participants.

`useCopilotPresence()` filters the local user out only when you pass its connectionId, and
`CopilotChat` passed nothing — so the header showed the user to themselves, in a variable the
code calls `otherPresence`. It could not do better: `CopilotContextValue` never exposed the id,
even though `CopilotProvider` receives it as `userConnectionId` and broadcasts with it.

`userConnectionId` is now on the context and `CopilotChat` filters by it. The field is OPTIONAL,
so a hand-built provider — the path `CopilotContext`'s docblock blesses for test harnesses —
keeps working unchanged, with the unfiltered behaviour it has today.
