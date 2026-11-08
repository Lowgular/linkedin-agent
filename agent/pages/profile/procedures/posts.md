# profile.posts

The posts the profile's Activity card shows — the member's latest, a preview of their activity page: each with its address, kind, author, age, text as shown and whether it is cut short, and its counts of reactions, comments and reposts. Reads only.

On profile. Stays.

## Input schema

is in `./posts.input.json` (relative to this file)

## Instructions

# The profile's posts

1. Read only the profile's Activity section with `capture_section` using
   `heading: "Activity"` and the supplied `run` and `tab`. If the section has
   not rendered, scroll the profile once and try `capture_section` again.
   If the section is still absent, the profile shows no posts. Use a whole-page
   capture only to locate an ambiguous or missing Activity heading; posts in
   Featured or other sections are not Activity posts.
2. Map each as the post cards read, in the card's order, up to the input's
   `limit`, 10 when none.
3. Ground counts in each individual post card's own footer. A `Comment` link
   without a numeric child is only an action: return `comments: 0`. A `Repost`
   button without a numeric child means `reposts: 0`. Use an explicit `<n> comments`
   or `<n> reposts` label only when it belongs to that same card. Never borrow
   numbers from another card, the post text, its age, or section navigation.
4. `more` is whether the Activity section shows a `Show all posts` link.
5. `ends` is the page id `"profile"` after this read, never the browser tab or run ID.

Reads only: click nothing — never the `Reaction button state`
button — open nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## Post cards

`capture_section` with `heading: "Activity"` reads the Activity card's posts on the profile, one after another, identified from the section structure:

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

The post's address is the `/feed/update/urn:li:activity:<id>/` link; a post in a group carries it as `highlightedUpdateUrn=urn%3Ali%3Aactivity%3A<id>` instead. A card whose header reads `<Name> reposted this` is a repost, `commented on` a comment; else a post. Counts read as shown; one that does not show is 0. Read any Show all posts link from the Activity section itself. If more Activity cards load as the profile scrolls, `scroll` the page, then `capture_section` with `heading: "Activity"`, deduplicating by URL, until you have enough or `atBottom`. Stay on the profile; never open the separate activity page. The `Reaction button state` button reacts: never click it.

## Output schema

is in `./posts.output.json` (relative to this file)
