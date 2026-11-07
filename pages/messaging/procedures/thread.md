# messaging.thread

The open conversation: who it is with — name, headline, profile address — or the group it is, and its messages as the pane shows them, oldest first: who sent each, whether it was you, when, and the text. The latest messages: older ones the pane has not loaded are not read. Reads only.

On messaging. Stays.

## Input schema

is in `./thread.input.json` (relative to this file)

## Instructions

# The conversation

1. Read the open conversation with `capture` with selector `main` and map it as the
   conversation reads: the header is the member — or the group with its member
   count — and the list under it is the messages, oldest first.
2. A message's sender is the `… sent the following message(s) at …` line of its
   item, or of the nearest item above it when its own has none; its date is the
   `time` that last stood on its own above it; its time is the one beside the
   sender's name. It is yours when a `Sent at …` line follows its text, or when
   the sender is not the member the conversation is with.
3. Read what the pane shows: do not scroll for older messages.

Reads only: type nothing in `Write a message…`, send nothing, click nothing,
open nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The conversation

`capture` with selector `main` reads the conversation open on the messaging page: its header, then its messages as a list, oldest first:

```yaml
- generic:
  - generic:                                   # the header
    - link "<Name> <headline>":
      - /url: https://www.linkedin.com/in/<id>/
      - generic:
        - term:
          - heading "<Name>" [level=2]
        - definition:
          - generic: <headline>
    - button "Open the options list in your conversation with <You> and <Name>"
  - list:
    - listitem:
      - time: Oct 12                           # a date on its own: the date of what follows, until the next
      - generic: <Sender> sent the following message at 2:52 PM
      - generic:
        - link "View <First>’s profile <Sender>"
        - generic:
          - link "<Sender>"
          - time: • 2:52 PM
        - generic:
          - paragraph: <the text>
          - generic "Sent at 10/12/2026, 2:52 PM"   # only under your own messages
    - listitem:                                # the next message by the same sender: the text alone
      - paragraph: <the text>
    - listitem:
      - generic: <Name> sent the following messages at 3:28 PM
      - generic:
        - link "<Name>"
        - time: • 3:28 PM
      - paragraph: <the text>                  # no Sent at line: theirs
```

A group conversation's header is the group's name as the heading with `<n> members` under it, and no member link. The `Write a message…` box under the list is not to be used.

## Output schema

is in `./thread.output.json` (relative to this file)
