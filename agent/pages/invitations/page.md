# invitations

the signed-in member's sent invitations, still pending: one entry per person invited, newest first — name, headline, when it was sent, the note if one was sent — each with a Withdraw link

Path pattern: `^/mynetwork/invitation-manager/sent(?:/|$)`

Open: `https://www.linkedin.com/mynetwork/invitation-manager/sent/`. Replace the placeholder with the member's slug or post URN.

The `Manage invitations` heading with the `Received` and `Sent` tabs, a `People (<n>)` tab under them, then the entries, each with `Withdraw invitation sent to <Name>`.
