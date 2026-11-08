# messaging.select

Open a conversation on the right: by its name as the list shows it, loading more of the list until it is found, or by its address, /messaging/thread/<id>/. LinkedIn marks the conversation read when it opens, as it does for anyone opening it; nothing is typed or sent. Ends on messaging, with that conversation open.

On messaging. Ends on: messaging.

## Input schema

is in `./select.input.json` (relative to this file)

## Instructions

# Open a conversation

1. Given an address — it holds `/messaging/thread/` — `navigate` to it and
   `wait_for_text` for the list `Conversation List`'s heading
   `Conversation List`; the open conversation is the
   one marked `. Active conversation`.
2. Given a name: read the list with `capture` with selector `role=list[name="Conversation List"]`
   and find the entry whose heading is exactly the name, clicking
   `Load more conversations` and capturing again while it is not there and the
   button shows. None: `failed` at this step, saying so. Found: `click` its
   heading and `wait_for_navigation` for `/messaging/thread/`.
3. Capture the list again: the entry is marked `. Active conversation`. `name`
   is its heading; `url` the location.

Type nothing in `Write a message…`, send nothing, click nothing else.

## Reading the page

Read `../../browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

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

is in `./select.output.json` (relative to this file)
