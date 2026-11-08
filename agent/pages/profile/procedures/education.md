# profile.education

The member's Education card: every school it shows — the school and its page, the degree and the dates as shown — and whether a Show all link leads to more. Reads only.

On profile. Stays.

## Input schema

is in `./education.input.json` (relative to this file)

## Instructions

# The education

1. Read the Education card with `capture_section` heading `Education`: it is
   scrolled to when it is further down. When the capture says no card is headed
   Education, the profile shows none: `schools` is empty and `hasMore` false.
2. Map each school as the Education card reads, in the card's order.
3. `hasMore` is whether the card ends in a `Show all`
   educations link.

Reads only: click nothing, open nothing.

## Reading the page

Read `../../../memories/browser.md` for generic capture, ref and pagination rules. Capture again after every action. Widget examples below describe LinkedIn content, not server-generated formatting.

## The Education card

`capture_section` with heading `Education` reads it:

```yaml
- generic:
  - generic:
    - heading "Education" [level=2]
  - generic:
    - generic:                                 # one school
      - link:
        - /url: https://www.linkedin.com/school/<id>/
        - figure:
          - img "<School> logo"
      - link:
        - generic:
          - generic:
            - paragraph: <School>
            - paragraph: <Degree>              # when shown
          - paragraph: 2010 – 2015             # when shown
  - link "Show all educations"                 # only when the card shows fewer than there are
```

The school's page is the `/school/` link's address; a school without a page has no link.

## Output schema

is in `./education.output.json` (relative to this file)
