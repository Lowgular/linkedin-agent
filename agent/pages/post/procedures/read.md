# post.read

The post as its page shows it: the author, the group it was posted in if any, the age, the text in full, the media, and the counts of reactions, comments and reposts. Reads only.

On post. Stays.

## Input schema

is in `./read.input.json` (relative to this file)

## Instructions

# The post

1. Read the post with `capture` with selector `main`: its header has the author — or the group
   and the author under it — then the age paragraph; the text is the paragraph
   after the `Open control menu for post by …` button, and a figure
   after it is the media.
2. The counts are at the bottom: the `Reaction button state`
   button holds the number of reactions, the `<n> reactions`, `<n> comments` and
   `<n> reposts` links read as shown; a count that does not show is 0.

Reads only: click nothing — never the `Reaction button state`
button, which would react — and open nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## Output schema

is in `./read.output.json` (relative to this file)
