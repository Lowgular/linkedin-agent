# post.reactors

Who reacted to the post, each as a basic profile: opens the Reactions dialog, reads its list — scrolling it until it ends or there are as many as asked — and closes it again. A member with their name, profile address, reaction, degree and headline; a company page with its name, address and reaction. Reads only.

On post. Stays.

## Input schema

is in `./reactors.input.json` (relative to this file)

## Instructions

# Who reacted

1. Read the post with `capture` with selector `main` and `click` its `<n> reactions` link — the
   link, never the `Reaction button state` button beside
   it, which would react. No such link: nobody reacted — `total` 0, no
   reactors, `complete` true.
2. Read the dialog with `capture` scoped to the observed visible dialog or menu: `total` is the number on its
   `All reactions` button. Map each reactor as the
   dialog reads. Fewer than the input's `limit` — 100 when none — and not
   `atBottom`: `scroll` with the dialog's ref, capture again and add the new
   ones, until the list ends or you have the limit.
3. `complete` is whether the list ended. Close the dialog with
   `Dismiss`.

After every scroll, capture again and process the newly visible entries before deciding whether to stop, even when the scroll reports `atBottom: true`. Reaching the bottom does not mean the final scroll revealed no new entries.

Reads only: click nothing but the reactions link and Dismiss.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## Dialogs

A dialog opens over the page and `capture` scoped to the observed visible dialog or menu reads it. The Reactions dialog:

```yaml
- dialog:
  - button "Dismiss"
  - heading "Reactions" [level=2]
  - button "<n> All reactions"            # then one button per reaction type, e.g. "2 Like reactions"
  - link:                                 # one per member, in the list under the buttons
    - /url: https://www.linkedin.com/in/<slug>/
    - generic "<Name> reacted with <Type>, <degree> degree connection, <headline>"
```

A reactor's link is a member's profile, `/in/<slug>/`, or a company page, `/company/<slug>/`, whose name reads `<Name> reacted with <Type>` without a degree. The list loads more as it scrolls: `scroll` with the dialog's ref and capture again, until `atBottom` or you have enough; the members already read repeat, so keep them by address. Close a dialog you opened with its `Dismiss` button before you report.

## Output schema

is in `./reactors.output.json` (relative to this file)
