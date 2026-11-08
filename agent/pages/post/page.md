# post

one post on its own page: the author, the time, the text and media, the counts of reactions and comments, the first reactors, then the comments

Path pattern: `^/feed/update/urn:li:(activity|share|ugcPost):\d+/?$`

Open: `https://www.linkedin.com/feed/update/<urn>/`. Replace the placeholder with the member's slug or post URN.

The main column shows the post card: the author's name linking to their profile, the age, the text, the `Reaction button state` button with the count, the `Comment` button, and a `<n> reactions` link; the comments are below it.
