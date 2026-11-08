# invitations.sent

The pending invitations the signed-in member sent, newest first, scrolling until there are as many as asked or the page shows no more: each with the name, profile address, headline, when it was sent and the note if one was sent. After every scroll, capture again and process the newly visible entries before deciding whether to stop, even when the scroll reports `atBottom: true`. Reaching the bottom does not mean the final scroll revealed no new entries.

Reads only: Withdraw is never clicked.

On invitations. Stays.

## Input schema

is in `./sent.input.json` (relative to this file)

## Instructions

# The sent invitations

1. Read the page with `capture` with selector `main`: `total` is the `People (<n>)` tab's
   count. Map each item as the sent invitations read, in order, up to the
   input's `limit`, 20 when none.
2. Fewer than the limit and not `atBottom`: `scroll` the page, capture again
   and add the items not yet read — by address — until you have the limit or
   the page ends.
3. `more` is whether items remained beyond the limit, or the page had not
   ended.

Reads only: `Withdraw` is never clicked.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The sent invitations

`capture` with selector `main` on the sent invitations page reads the tabs, then one item per invitation, newest first:

```yaml
- link "People (29)"                           # how many are pending
- generic:
  - listitem:
    - generic:
      - link:
        - /url: https://www.linkedin.com/in/<slug>/
        - figure:
          - img "<Name>’s profile picture"
      - generic:
        - paragraph: <Name>
        - paragraph: <headline>                # when shown
        - paragraph: Sent today                # Sent 2 minutes ago, Sent 4 days ago
      - link "Withdraw invitation sent to <Name>"
    - paragraph:                               # only when a note was sent
      - generic:
        - text: <the note, as far as shown>
        - button:
          - generic: … show more
```

The page loads more as it scrolls: `scroll` and capture again until you have enough or `atBottom`. `Withdraw` is never clicked.

## Output schema

is in `./sent.output.json` (relative to this file)
