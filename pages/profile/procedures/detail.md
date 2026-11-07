# profile.detail

The member's profile in detail: the top card — name, headline, location, degree of connection, connections and followers as shown, company and school, the profile's address — and the About text, whole. Reads only.

On profile. Stays.

## Input schema

is in `./detail.input.json` (relative to this file)

## Instructions

### The profile in detail

- Get active tab for that profile or open a new tab with that profile
- Read the example below to know what data is needed and where to find it
- Call `capture` with selector `main` and extract the actual data
- Read the follower count from the top card when shown. If absent, use the profile's Activity section as described below before returning `followers: null`.
- Map captured data into output schema provided below

### Followers in Activity

If the main capture already includes the Activity heading and its follower count, use that count. Otherwise call `capture_section` with `heading: "Activity"` on the same run and tab. If Activity has not rendered, scroll down the profile and capture again until Activity appears or the page reaches its bottom, then capture the Activity section.

Read the follower count directly below the Activity heading, associated with the `/feed/followers/` link:

```yaml
- heading "Activity" [level=2]
- link:
    - /url: https://www.linkedin.com/feed/followers/
    - paragraph: 2,850 followers
```

Normalize the displayed number to an integer: `2,850 followers` becomes `2850`. Use only the profile owner's count in the top card or Activity header; do not use counts from posts, suggested profiles or company recommendations. Return `null` only when neither location shows a follower count after checking Activity. Reads only; do not click the followers link.

## Example

This is an example of `capture` with selector `main`. All the data to capture is written in this format `<variable>`.

```yaml
- generic:
    - generic: # the photos
        - link:
            - /url: https://www.linkedin.com/in/<slug>/
            - generic "Profile photo"
        - link "Edit profile" # only on the signed-in member's own profile
    - generic:
        - generic:
            - link:
                - /url: https://www.linkedin.com/in/<slug>/
                - generic:
                    - heading "<name>" [level=2]
            - paragraph: · 3rd # the degree: · 1st, · 2nd or · 3rd+; none on your own profile
            - paragraph: <headline>
            - generic:
                - paragraph: <location>
                - paragraph: ·
                - paragraph:
                    - link "Contact info":
                        - /url: https://www.linkedin.com/in/<slug>/overlay/contact-info/
        - button: # the company, with its logo
            - generic:
                - figure
                - paragraph: <company>
        - button: # the school, when one shows
            - generic:
                - figure
                - paragraph: <school>
    - paragraph: <followers> followers # only when the profile shows its followers here
    - link:
        - /url: https://www.linkedin.com/mynetwork/invite-connect/connections/
        - paragraph: 500+ connections
    - generic: # the actions row
        - button "Connect" # or "Invite <Name> to connect": not connected, and Connect is here …
        - button "Pending" # … or an invitation is pending …
        - button "Follow <name>" # … or Connect is in the More menu
        - button "Message"
        - button "More"
```

If you do not find any of the information - make sure to use scrolling and recapture the `main` area again.

## Output schema

is in `./detail.output.json` (relative to this file)
