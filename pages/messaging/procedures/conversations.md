# messaging.conversations

The conversations in the list, newest first, loading more until there are as many as asked or it shows no more: each with its name, participants, the time of the last message, that message as a preview and who sent it, whether it is open and whether it is unread. Reads only.

On messaging. Stays.

## Input schema

is in `./conversations.input.json` (relative to this file)

## Instructions

# The conversations

1. Read the list with `capture` with selector `role=list[name="Conversation List"]` and map each
   entry as the conversation list reads, in order, up to the input's `limit`,
   20 when none.
2. Fewer than the limit and a `Load more conversations` button at the end:
   `click` it, capture again and add the new entries, until you have the limit
   or no button shows.
3. `more` is whether a `Load more conversations` button still showed.

Reads only: open no conversation, type nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The conversation list

`capture` with selector `role=list[name="Conversation List"]` reads the messaging page's list, newest first:

```yaml
- list "Conversation List":
  - listitem:
    - generic [cursor=pointer]:
      - generic:
        - img "<Name>"
        - checkbox "Select conversation with <Name>"
      - generic:
        - generic:
          - heading "<Name>" [level=3]        # the member, or the group's name
          - time: 7:44 PM                      # the last message's time: 7:44 PM, Oct 21, Friday
        - generic:
          - paragraph: "You: Ok great thanks"  # the last message, prefixed You: or <First name>:
      - generic: . Active conversation         # only on the open one
    - button "Open the options list in your conversation with <You> and <Name>"
  - listitem:
    - button "Load more conversations"         # at the end, when there are more
```

Who sent the last message is the preview's prefix: `You:` is you, a first name is them, none is neither — an attachment, or a group. An entry that marks the conversation unread says `unread`. `click` an entry's heading to open its conversation on the right; `click` `Load more conversations` and capture again for more.

## Output schema

is in `./conversations.output.json` (relative to this file)
