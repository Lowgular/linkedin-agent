# activity.posts

The posts on the activity page, newest first, scrolling the page until there are as many as asked or it ends: each with its address, kind, author, age, text as shown and whether it is cut short, and its counts of reactions, comments and reposts. Reads only.

On activity. Stays.

## Input schema

is in `./posts.input.json` (relative to this file)

## Instructions

# The posts

1. Read the cards with `capture` with selector `main` and map each as the post cards read, in
   the card's order. The limit is the input's `limit`, 10 when none.
2. Fewer than the limit and not `atBottom`: `scroll` the page, then
   `capture` with selector `main`, adding only posts not yet read by URL, and go on —
   until you have the limit, or the page ends.
3. `more` is whether cards remained beyond the limit, or the page had not
   ended.

After every scroll, capture again and process the newly visible entries before deciding whether to stop, even when the scroll reports `atBottom: true`. Reaching the bottom does not mean the final scroll revealed no new entries.

Reads only: click nothing — never the `Reaction button state`
button — open nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## Post cards

`capture` with selector `main` reads the post cards — on the activity page, or in the Activity card of a profile — one after another, identified from the page structure:

```yaml
- listitem:
  - generic:
    - generic:
      - link:                                  # the author
        - /url: https://www.linkedin.com/in/<slug>/
        - generic "<Author> Verified Profile":
          - paragraph: <Author>
          - paragraph:
            - generic: • You                   # or • 1st, • 2nd …; a group post links to the group instead
      - paragraph: <the author's headline>
      - paragraph: 13h                         # the age: 6h, 1d • Edited, 2w
    - button "Open control menu for post by <Author>"
  - link:
    - /url: https://www.linkedin.com/feed/update/urn:li:activity:<id>/
    - paragraph:
      - generic:
        - text: <the text, as far as the card shows it>
        - button:                              # only when the text is cut short
          - generic: … more
  - link:                                      # the media, when any
    - figure:
      - img "View image"
  - generic:                                   # the counts
    - button "Reaction button state: no reaction":
      - generic: "3"                           # the reactions
    - link "Comment":
      - generic: "1"                           # the comments, when any
    - button "Repost":
      - generic: "1"                           # the reposts, when any
    - link:
      - generic "3 reactions"
```

The post's address is the `/feed/update/urn:li:activity:<id>/` link; a post in a group carries it as `highlightedUpdateUrn=urn%3Ali%3Aactivity%3A<id>` instead. A card whose header reads `<Name> reposted this` is a repost, `commented on` a comment; else a post. Counts read as shown; one that does not show is 0. Read any Show all posts link from the page itself. The page loads more cards as it scrolls: `scroll` the page, then `capture` with selector `main`, deduplicating by URL, until you have enough or `atBottom`. The `Reaction button state` button reacts: never click it.

## Output schema

is in `./posts.output.json` (relative to this file)
