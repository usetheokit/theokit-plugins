---
'@theokit/plugin-forms': minor
---

File uploads work. `<TheoForm encType="multipart/form-data">` converts the form's values to the
`FormData` shape the framework reconstructs.

The README said "No file uploads in v0.1", and measurement refuted the framing twice. The file
always reached the action — `TheoField` renders no input of its own, and `useAction` does not
serialise. And the rest of the stack already did multipart end to end: the client invoker sends a
`FormData` body untouched, and an action declaring `accept: 'form'` reconstructs an object from it
guided by the Zod schema. What was missing was one conversion in this package.

It is a shipped function rather than a documented snippet because the convention is not the obvious
one: dot notation for nesting, and **repeated keys** for arrays. A hand-rolled walk produces
`tags[0]`/`tags[1]`, which the other side does not find — the field arrives empty with no error
anywhere.

Two things to know when you use it:

- Write `z.array(z.instanceof(File))`, even for a single file. A registered file input holds a
  `FileList`, which this package now normalises to `File[]` before validation — previously the
  natural schema failed client-side and the submit never happened.
- Your action must declare `accept: 'form'` server-side. That is where the body is parsed and this
  package cannot see it.

Also: `encType` is now a real prop. It was hardcoded `application/x-www-form-urlencoded` on every
form — the attribute a reader inspects to answer exactly this question, answering it wrongly.

Known limitation, pinned by a test: a multipart **scalar** array collapses to its last element
(`['a','b']` arrives as `['b']`). The cause is in the framework's body parser, upstream of anything
this package controls. Arrays of files are unaffected.
