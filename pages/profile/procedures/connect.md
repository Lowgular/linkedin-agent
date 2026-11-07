# profile.connect

Send a connection invitation to the member whose profile is open, with the note given or without one. The one method here that writes: it clicks Send, once, only when told to by this call. Verifies the top card shows Pending after. Never withdraws, never retries a Send.

On profile. Stays.

## Input schema

is in `./connect.input.json` (relative to this file)

## Instructions

# Connect with the member

1. Read the top card with `capture` with selector `main`. The name is the heading. When a
   `Pending` button shows, the outcome is `already-pending`; when the degree is
   1st, `already-connected`: report, sending nothing.
2. Find Connect: a `Connect` or `Invite <Name> to connect` button in the top
   card, else `click` the top card's `More` button, read the menu with
   `capture` scoped to the observed visible dialog or menu and find the `Invite <Name> to connect` item. The name must
   be the top card's: anyone else's Connect — `People you may know` — is not
   this member's. When there is none, the outcome is `unavailable`.
3. `click` it and read the dialog with `capture` scoped to the observed visible dialog or menu: it is headed
   `Add a note to your invitation?`. When it asks for the member's email, click
   `Dismiss`: the outcome is `email-required`.
4. With no note given, `click` `Send without a note`. With a note, `click`
   `Add a note`, read the dialog again, `fill` the note into its textbox exactly
   as given, and `click` `Send`. Either way Send is clicked once: never twice,
   whatever happens after.
5. Verify with `capture` with selector `main`, after `wait_for_text` for `Pending` within
   `main`: `Pending` shows — the outcome is `sent`. It does not — `unverified`,
   with what the page says in `message`.

When a step fails before Send, close the dialog or menu you opened with its
`Dismiss` button before you report, and say so in `evidence`.

Click nothing else: not `Pending`, not `Withdraw`, not `Follow`, not `Message`.
Type nothing but the note. A note is sent exactly as given, never rewritten.

## Reading the page

Read `../../browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The top card

`capture` with selector `main` reads a profile's top card:

```yaml
- generic:
  - generic:                                   # the photos
    - link:
      - /url: https://www.linkedin.com/in/<slug>/
      - generic "Profile photo"
    - link "Edit profile"                      # only on the signed-in member's own profile
  - generic:
    - generic:
      - link:
        - /url: https://www.linkedin.com/in/<slug>/
        - generic:
          - heading "<Name>" [level=2]
      - paragraph: · 3rd                       # the degree: · 1st, · 2nd or · 3rd+; none on your own profile
      - paragraph: <headline>
      - generic:
        - paragraph: <location>
        - paragraph: ·
        - paragraph:
          - link "Contact info":
            - /url: https://www.linkedin.com/in/<slug>/overlay/contact-info/
    - button:                                  # the company, with its logo
      - generic:
        - figure
        - paragraph: <Company>
    - button:                                  # the school, when one shows
      - generic:
        - figure
        - paragraph: <School>
  - paragraph: 40,746,647 followers            # only when the profile shows its followers here
  - link:
    - /url: https://www.linkedin.com/mynetwork/invite-connect/connections/
    - paragraph: 500+ connections
  - generic:                                   # the actions row
    - button "Connect"                         # or "Invite <Name> to connect": not connected, and Connect is here …
    - button "Pending"                         # … or an invitation is pending …
    - button "Follow <Name>"                   # … or Connect is in the More menu
    - button "Message"
    - button "More"
```

The name is the heading. The degree is the paragraph after it — `· 1st`, `· 2nd`, `· 3rd+` — `self` when `Edit profile` shows instead, `none` when neither does. The headline is the paragraph under the name's link; the location the paragraph beside `·` and the `Contact info` link, and null when none is there. Connections and followers read as shown, and followers are null when the top card shows none. The company and the school are the buttons with a figure and a name under the headline, in that order: one button is the company. The profile's address is the `Contact info` link's, without its `overlay/contact-info/`. The actions row tells the relationship: a 1st degree is connected; a `Pending` button is an invitation sent and not yet accepted; `Message` alone proves nothing.

## Connecting

When `Connect` is not in the top card's actions row, it is in the `More` menu, which `capture` scoped to the observed visible dialog or menu reads once the button is clicked:

```yaml
- menu:
  - menuitem:
    - paragraph: View in Sales Navigator
  - menuitem:
    - paragraph: Send profile in a message
  - menuitem:
    - generic "Invite <Name> to connect":
      - paragraph: Connect
  - menuitem:
    - paragraph: Report <First>
```

Clicking Connect opens the invitation dialog:

```yaml
- dialog:
  - button "Dismiss"
  - heading "Add a note to your invitation?" [level=2]
  - generic:
    - button "Add a note"
    - button "Send without a note"
```

For some members LinkedIn asks for their email instead — the dialog shows `To verify this member knows you, please enter their email` with a textbox, and `Send without a note` is disabled: that invitation cannot be sent this way. After `Add a note`, the dialog holds a textbox for the note, with a count of characters left, and the buttons `Cancel` and `Send`. Once sent, the dialog closes and the top card's actions row shows `Pending` in place of Connect.

## Output schema

is in `./connect.output.json` (relative to this file)
