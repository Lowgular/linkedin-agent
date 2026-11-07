# profile

a member's profile page: the top card — name, headline, location, connections — then the cards About, Activity, Experience and the rest

Path pattern: `^/in/[^/]+/?$`

Open: `https://www.linkedin.com/in/<slug>/`. Replace the placeholder with the member's slug or post URN. The signed-in member's own profile is `https://www.linkedin.com/in/me/`, which LinkedIn redirects to it.

The top card shows the member's name as a heading, the headline under it, then the location beside the `Contact info` link; below it the cards each start with a heading: `About`, `Activity`, `Experience`.
