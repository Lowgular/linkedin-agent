# profile.experience

The member's Experience card: every position it shows — title, company and its page, employment type, dates, duration, location, description as shown — and whether a Show all link leads to more. Reads only.

On profile. Stays.

## Input schema

is in `./experience.input.json` (relative to this file)

## Instructions

# The experience

1. Read the Experience card with `capture_section` heading `Experience`: it is
   scrolled to when it is further down. When the capture says no card is headed
   Experience, the profile shows none: `positions` is empty and `hasMore` false.
2. Map each position as the Experience card reads, in the card's order: a
   company with several positions gives one per item of its list, each with
   that company and its page.
3. `hasMore` is whether the card ends in a `Show all`
   experiences link.

Reads only: click nothing — not `… more`, not
`Show all` — open nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The Experience card

`capture_section` with heading `Experience` reads it. An entry is a company with several positions, or one position on its own:

```yaml
- generic:
  - generic:
    - heading "Experience" [level=2]
  - generic:                                   # the entries, newest first
    - generic:                                 # a company with several positions
      - generic:
        - link:
          - /url: https://www.linkedin.com/company/<id>/
          - figure:
            - img "<Company> logo"
        - link:
          - /url: https://www.linkedin.com/company/<id>/
          - generic:
            - paragraph: <Company>
            - paragraph: Full-time · 2 yrs 9 mos        # the employment type, when one, then the tenure
      - list:
        - listitem:                            # one position
          - generic:
            - link:
              - generic:
                - paragraph: <Title>
                - paragraph: Full-time         # the employment type, when shown
                - paragraph: Jan 2025 - Present · 1 yr 10 mos
                - paragraph: <Location>        # when shown
            - paragraph:                       # the description, when one; cut short with a … more button
              - generic: <the description>
    - generic:                                 # one position on its own
      - link:
        - /url: https://www.linkedin.com/company/<id>/
        - figure:
          - img "<Company> logo"
      - generic:
        - link:
          - generic:
            - generic:
              - paragraph: <Title>
              - paragraph: <Company>           # or <Company> · Full-time
            - paragraph: Oct 2017 - Nov 2019 · 2 yrs 2 mos
            - paragraph: <Location>            # when shown
        - paragraph: <the description>         # when one
  - link "Show all experiences"                # only when the card shows fewer than there are
```

A position's lines read in LinkedIn's order: the title; the employment type, when shown; the dates, with the duration after ` · `; the location, when shown. In a company's list, the company and its employment type come from the lines above the list, and the company's page is the `/company/` link's address; a company without a page has no link. The description is as shown, cut short where it is: `… more` is not clicked.

## Output schema

is in `./experience.output.json` (relative to this file)
