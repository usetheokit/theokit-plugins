---
'@theokit/plugin-forms': patch
---

The README's Cookbook 1 produced an inaccessible form; it now produces an accessible one.

`FormField.Control` clones its DIRECT child to inject `id`, `aria-invalid` and
`aria-describedby`, and the example put a consumer component in that slot, which received those
props and dropped them: the label pointed at an id nothing had, and the invalid state was never
announced (#105). `FormField.Error` renders its children and reads nothing on its own, so the
self-closing `<FormField.Error />` showed an empty alert while the server's reason was discarded
(#106).

Documentation only — no runtime change. Both shapes are now pinned by tests that assert the
accessible relationships rather than the markup.
