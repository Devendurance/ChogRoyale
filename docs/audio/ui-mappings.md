# UI audio mapping

UI audio is presentation-only. A cue is played from the user action or from
an observed server-confirmed state transition. Failed requests do not play a
success cue. Polling and the initial historical read do not play notification
audio.

| Semantic cue | Source event | When it plays | Explicitly excluded |
| --- | --- | --- | --- |
| `primary` | Primary app action | A user presses an enabled primary action | Disabled, hover, focus, typing, scroll |
| `secondary` | Secondary action | A user presses an enabled secondary action | Disabled, hover, focus |
| `navigation` | App link, tab, disclosure | A user activates navigation or a disclosure | Passive route changes |
| `card-select` | Deck/card selection | A card, commander, friend, or gift choice changes | Invalid or disabled choice |
| `card-drag` | Card drag gesture | A drag starts or completes on an eligible card | Pointer movement without a drag |
| `placement` | Authoritative placement acknowledgement | Battle core observes the server acknowledgement for the placement intent | Pointer intent, advisory preview or rejected placement |
| `success` | Confirmed mutation | Server response and authoritative reread confirm the mutation | Generic notice text, optimistic state |
| `error` | Refusal or failed action | A server/network failure is surfaced for an attempted action | Background read failures and initial gates |
| `friend-request` | Friend mutation or newly observed request | Send or accept returns successfully, or a new incoming request appears after the baseline read | Initial history, polling repeats, search results, decline, remove, block |
| `notification` | New received message | A newly observed received message appears after the baseline | Initial history, already-seen rows, polling repeats |
| `invite` | Invite copy/share | Room invite is copied or shared successfully | Opening the invite panel |
| `ready` | Battle-ready confirmation | The server reflects this player as ready for the first time | Submit intent, re-rendered ready state or server refusal |
| `upgrade` | Confirmed card upgrade | After the server returns `upgraded` for the request | Initiation, duplicate, refused or uncertain completion |
| `reward` | Confirmed sponsorship/reward | `sponsored` only, after authoritative history refresh | `duplicate` repeats the reward chime |
| `confirm` | Confirmation dialog | An enabled confirm button is pressed | Cancel, backdrop, escape |
| `reveal` | Revealed result | A confirmed reward or result is shown for the first time | Re-rendering the same result |

The audio provider must dedupe event-derived cues by account/session and reset
its seen set when the account changes. Sound controls remain available on
authenticated and unauthenticated settings gates.

Controls that play a semantic cue synchronously carry `data-audio-skip="true"`
so the global generic click fallback does not add a second sound. Async server
confirmation cues intentionally remain separate from the initial action cue.
