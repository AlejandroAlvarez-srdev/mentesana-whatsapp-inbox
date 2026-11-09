# Post-mortem: losing four WhatsApp Business accounts in three days (Nov 2026)

**Status:** the fixes for the root causes have shipped. At the time of writing the numbers are still banned and we are appealing.
**Format:** blameless.
**Author:** Alejandro Álvarez (CTO).

Phone numbers, account IDs and people are left out on purpose. All counts come from our own send logs.

## Summary

WhatsApp is the main way a patient talks to the clinic. Appointment reminders, the link to join a session and sales conversations all go through it.

- **5 Nov:** Meta banned our three live WhatsApp Business accounts at the same time. In the previous six days they had sent about **2,150 marketing templates**.
- **6 Nov:** we connected a fresh number and moved transactional traffic to it.
- **7 Nov:** that number was banned too, about 36 hours after it went live. It had sent about **330 templates**, and Meta also rejected its display name.

Both bans had the same cause: we sent marketing volume our recipients did not want. The second ban came faster because of how we used the new number. To Meta it looked like an attempt to get around the first ban.

## Impact

- About 2½ days without any WhatsApp sending. During that time there were no reminders, no session links and no outbound sales by WhatsApp.
- Paid acquisition got worse over the weekend. Our recovery flows (abandoned checkout and reminder before the first session) relied partly on WhatsApp. Cost per first session rose from about €39/day on average during the week to about €70 on Saturday and Sunday.
- We lost sales reach to past patients, our best-converting audience.

## Timeline (Europe/Madrid)

| When | What happened |
|---|---|
| 26–31 Oct | Several renewal and "last chance at the old price" campaigns went out from three numbers, about 2,150 templates in total. The campaigns made money. Opt-out replies such as "BAJA" ("unsubscribe") and "stop writing to me" rose, but nothing in the system acted on them. |
| 5 Nov | All three accounts were banned at the same time. |
| 5 Nov | I built `wa-send-guard.ts`. A batch now goes out only from a GREEN number, with a cap per number per day, and opted-out phones are removed. |
| 6 Nov, morning | We connected a new number with its display name still pending review. |
| 6 Nov, 14:00–15:20 | **50** copies of one identical template went to existing patients: "we changed our WhatsApp number because the old one stopped working". |
| 6 Nov, 19:00–20:40 | A win-back campaign went to **100** past patients whose package had run out. It offered one session with their own psychologist and used 4 copy variants. 13 people replied, 6 opted out and 2 bought. |
| 6 Nov, evening | Agents scheduled **126** more marketing messages for the next morning, using 2 generic templates. Nothing checked them against the win-back campaign. |
| 7 Nov, 09:30–10:00 | The 126 marketing messages went out, plus **40** more copies of "we changed our number". |
| 7 Nov, 10:40 | The number was paused for marketing. The guard cancelled the remaining batches, but the number was already banned. Its quality was RED and its display name was rejected. |

## Root causes

1. **We announced the new number by mass message.** The same text ("we changed our number because the old one stopped working") went to 90 patients from a number with no history, one day after a ban. That is exactly what evading a ban looks like. We had approved variants of the message but used only one.
2. **There was no single owner of the volume sent from each number.** Two scripts and a team of agents each scheduled sends on their own. The system did not know that the same person might receive three marketing messages in 24 hours.
3. **Our list of who not to contact remembered too little.** The win-back list left out only people who had received a message in the last 7 days. Many recipients had received 2–4 renewal messages in late October. One reply said, roughly: "this is the fourth time you have asked me; stop".
4. **Quality signals did not stop anything in time.** Opt-out replies were counted but not saved as opt-outs for future campaigns. Webhooks from Meta about template quality and recategorisation were not consumed at all. The guard checked number quality per batch, but that rating updates more slowly than people block and report.
5. **A new number was treated like an established one.** A fresh number with its display name pending got the same marketing volume as a number with months of good history.

## What went well

- The send guard did its job. As soon as Meta paused marketing, it cancelled every scheduled batch, so nothing more went out.
- Every opt-out reply was saved, and that person is excluded from WhatsApp and from in-app outreach.
- The win-back campaign still paid for itself. When someone paid, a cron job created the one-session package on its own, with no manual work.

## What we changed

| Change | Where |
|---|---|
| Webhooks from Meta (opt-outs, template quality, status and category) now feed an opt-out table and a template health table, with an email alert on any change | `src/app/api/whatsapp/meta-events/route.ts`, `src/lib/wa-meta-events.ts` |
| The sender cancels batches whose template is RED, PAUSED, DISABLED or FLAGGED | `templateBlock()` in `src/lib/wa-send-guard.ts` |
| Opt-outs also match business-scoped user IDs, not only phone numbers | `optoutKey()` |
| A GREEN-only gate, a cap per number per day, and overflow moved to the next morning | `src/lib/wa-send-guard.ts` |

Rules we follow from now on:

- **A new number sends only transactional messages** (reminders, session links, receipts) until its display name is approved and it has had several weeks of GREEN quality.
- **Never announce a number change by mass message.** People find the new number through the next reminder they were already going to get.
- **A marketing list leaves out anyone who received marketing in the last 30 days, on any number.** An opt-out applies to every channel.
- **One owner per number for bulk sends.** Agents can send to one conversation, but scheduling a campaign goes through the same queue as everything else.
- **Rotate copy variants within a batch.** One identical text sent to hundreds of people is a spam signal by itself.

## Lessons

- **A quality signal nobody enforces is just a dashboard.** We had the data (opt-out replies, YELLOW warnings) days before the first ban.
- **The platform judges intent, not code.** Every single message was "allowed". What got us banned was the overall pattern: volume, repetition, a fresh number and an audience that had already said no.
- **What we optimise for matters.** The late-October campaigns made real money, so we kept sending. The trade-off we did not price in was the channel itself. Now a campaign is approved on revenue plus opt-out rate, not revenue alone.
