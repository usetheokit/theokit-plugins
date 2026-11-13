---
'@theokit/plugin-db-drizzle': minor
---

Stop writing the database URL into the generated config and the `push` argv. The generated `drizzle.config.ts` now reads `process.env[urlEnv]` (new option, default `DATABASE_URL`), `push` runs through `--config` like `migrate` and `studio`, and every command carries an `env` field the caller must pass to the spawned process.
