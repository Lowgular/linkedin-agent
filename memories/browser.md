# Using the generic browser tools on LinkedIn

`dev-browser` supplies only generic browser operations. Every page call includes
`run` and `tab`. Ref actions additionally include the latest `captureId` and ref.

- `capture`: whole page by default, or one element selected with `selector`.
  Start with `selector: "main"` when a single main exists. Narrow later captures
  using structure actually observed on the page.
- `capture_section`: exact `heading`, e.g. About or Experience. Scroll first if
  the heading has not rendered yet. Optional selector/heading level disambiguates.
- `click`, `fill`, `type`, `press_key`: act on a ref from a fresh capture. `fill`
  replaces contents; `type` appends. Empty fill clears an editable field.
- `scroll`: document or a captured scroll container; supply ref/captureId for
  the latter. It returns atBottom but not whether delayed content will load.
- `wait_for_text`: exact text, optionally scoped by selector.
- `wait_for_navigation`: URL substring in `urlIncludes` (not a regular expression).
- `page_info`: actual current URL and title.

To read a top card, post, feed or conversation, capture the main column and
interpret the appropriate part using the procedure's widget examples. To read a
named list, use a selector such as `role=list[name="Conversation List"]`.
For a dialog/menu, select the single visible dialog/menu you observed, for example
`dialog[open]` or `[role=dialog]:visible`. If several match, disambiguate from a
whole-page capture instead of guessing.

These captures do not exclude all asides automatically, create per-post footer
counts, skip already read entries, or find an absent card by scrolling. Perform
those steps explicitly using observed structure and deduplicate by URL. Check
for Show all or Load more in the UI itself. Normalize LinkedIn output URLs as
specified by the procedure, excluding the service's run query parameter.
