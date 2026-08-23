---
'@theokit/plugin-realtime': patch
---

Removes `RoomContextValue.subscribe`, which nothing called.

It was the only writer to the provider's listener set, and nothing called it — so the notify loop
ran over an empty set on every frame. Neither `RoomContext` nor `RoomContextValue` is exported,
so it was unreachable from outside the module too.

No behaviour change: `setStateAndNotify` still keeps `stateRef` in step with the state the frame
loop reads, which is the reason it exists.
