---
'@theokit/plugin-db-drizzle': minor
---

Deprecate `buildDbCommands` in favour of `theokit db migrate | push | generate | seed`. It keeps working and returns the same seven descriptors. The README now leads with `theokit db`.
