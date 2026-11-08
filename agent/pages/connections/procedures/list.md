# connections.list

The connections on the page, newest first, scrolling until there are as many as asked or it shows no more: each with their name, profile address, headline and the date the connection was made. Reads only.

On connections. Stays.

## Input schema

is in `./list.input.json` (relative to this file)

## Instructions

# The connections

1. Read the page with `capture` with selector `main`: `total` is the heading's count. Map each
   block as the connections read, in order, up to the input's `limit`, 20
   when none.
2. Fewer than the limit and not `atBottom`: `scroll` the page, capture again
   and add the blocks not yet read — by address — until you have the limit or
   the page ends.
3. `more` is whether blocks remained beyond the limit, or the page had not
   ended.

After every scroll, capture again and process the newly visible entries before deciding whether to stop, even when the scroll reports `atBottom: true`. Reaching the bottom does not mean the final scroll revealed no new entries.

Reads only: click nothing, type nothing in the search box.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The connections

`capture` with selector `main` on the connections page reads the heading, the search box, then one block per connection, newest first:

```yaml
- heading "2,695 connections" [level=2]
- textbox "Search your connections"
- generic:
  - generic:                                   # one connection
    - link:
      - /url: https://www.linkedin.com/in/<slug>/
      - figure:
        - img "<Name>’s profile picture"
    - generic:
      - link:
        - /url: https://www.linkedin.com/in/<slug>/
        - generic:
          - paragraph: <Name>
          - paragraph: <headline>              # when shown
      - paragraph: Connected on October 22, 2026
    - generic:
      - link "Send a message to <Name>"
      - button "More actions for <Name>"
```

The page loads more as it scrolls: `scroll` the page and capture again until you have enough or `atBottom`; the blocks already read repeat, so keep them by address. Click nothing: not `Message`, not `More actions`.

## Output schema

is in `./list.output.json` (relative to this file)
