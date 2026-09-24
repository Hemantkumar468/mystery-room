# CRM §4 — Provider onboarding

**Start this before any code is written.** None of it is code-blocked; all of
it is paperwork-blocked, and the waits are measured in days.

Rough waits, from experience — treat as planning figures, not promises:

| Step | Typical wait |
|---|---|
| Meta Business verification | 2–10 working days |
| WhatsApp Business API number approval | 1–3 days after verification |
| Each message template | 1 hour – 2 days, per template |
| Exotel / Twilio KYC + number provisioning (India) | 3–7 working days |

Four weeks of building followed by a week of sitting still is the outcome this
document exists to prevent.

---

## 1. Meta — WhatsApp Business

### What to do, in order

1. **Meta Business Manager account** — business.facebook.com. Skip if one
   already exists for the Mystery Rooms Facebook/Instagram pages.
2. **Business verification.** Needs, for the registered entity:
   - Certificate of incorporation or GST registration
   - A utility bill or bank statement showing the registered address
   - A business phone number Meta can call, on a line somebody answers
   - The website's domain, matching the business name
3. **WhatsApp Business Account** inside Business Manager, and a number to
   attach. **Use a number nobody uses on the WhatsApp app** — attaching it to
   the API deregisters the consumer app on that number permanently.
4. **System user + permanent access token**, with `whatsapp_business_messaging`
   and `whatsapp_business_management`.
5. **Submit the templates below** for approval. Do this the same day
   verification clears; approvals queue independently and each one can bounce.

### The five templates to submit first

Meta rejects templates that read like marketing when they are declared as
utility, and rejects variables that could be anything. Category matters: a
UTILITY template can be sent inside the 24-hour window and to users who
initiated contact; MARKETING needs an explicit opt-in and costs more.

**1. Enquiry received** — category: UTILITY

```
Hi {{1}}, thanks for your interest in a Mystery Rooms franchise.
We've received your enquiry and {{2}} from our team will call you within
24 hours.

Reply STOP to opt out.
```
`{{1}}` = first name · `{{2}}` = agent's first name

**2. Demo / site visit confirmation** — category: UTILITY

```
Hi {{1}}, your Mystery Rooms franchise walkthrough is confirmed for
{{2}} at {{3}}.

{{4}} will meet you there. Reply here if you need to reschedule.
```
`{{1}}` name · `{{2}}` date · `{{3}}` time · `{{4}}` agent name

**3. Proposal sent** — category: UTILITY

```
Hi {{1}}, your Mystery Rooms franchise proposal is ready.

{{2}}

It's valid until {{3}}. Happy to walk you through it — just reply here.
```
`{{1}}` name · `{{2}}` document link · `{{3}}` validity date

**4. Follow-up nudge** — category: UTILITY

```
Hi {{1}}, following up on our conversation about the {{2}} franchise.

Is there anything you'd like clarified before we take the next step?
```
`{{1}}` name · `{{2}}` city

**5. Thank you / welcome** — category: UTILITY

```
Welcome aboard, {{1}}. Your Mystery Rooms franchise agreement for {{2}} is
signed.

{{3}} will be your point of contact through setup and will be in touch this
week.
```
`{{1}}` name · `{{2}}` city · `{{3}}` onboarding manager

### Two rules that shape the code, so decide them now

- **The 24-hour window.** Outside 24 hours from the customer's last message,
  only approved templates send; free text is rejected by the API. Every
  outbound path therefore needs a template fallback, which is why the list
  above must exist before the UI is designed around it.
- **Opt-in is not optional.** Meta's policy and the DPDP Act both require it,
  and both require you to be able to evidence it. `Contact.whatsappOptIn`,
  `whatsappOptInAt` and `whatsappOptInSource` already exist on the model for
  exactly this. Decide where consent is captured — the web form's checkbox is
  the usual answer — and keep the wording.

---

## 2. Telephony — Exotel or Twilio

### The choice

| | **Exotel** | **Twilio** |
|---|---|---|
| Per-minute cost, India | Lower, often meaningfully | Higher |
| India compliance | Built for it — DLT, TRAI, local numbers routine | Works, but more paperwork on your side |
| Number provisioning | Indian virtual numbers are the core product | Available; India regulatory steps are extra |
| Docs and SDK | Adequate; some endpoints are dated | Excellent, well-versioned, good webhooks |
| Recording storage | Provided, expiring URLs | Provided, expiring URLs |
| Support | India business hours | 24/7, deeper |

**Recommendation: Exotel**, on cost and on India-specific compliance being
their default rather than an exception. Twilio is the better developer
experience and worth the premium if the same platform will later serve markets
outside India — but that is not the current business.

Either way the code is written against a thin adapter, so the decision is
reversible at the cost of one file. What is *not* reversible cheaply is the
number: porting takes weeks, so pick the provider before buying it.

### What both need from you

- Company registration + GST certificate
- Address proof for the registered office
- Authorised signatory's ID
- **DLT registration** (TRAI) if any SMS is planned — separate process, and
  slower than everything else here
- A decision on how many numbers: one per city, or one central number with
  routing? This affects cost and cannot be changed casually later.

### Ask the provider these before signing

1. Does the API return a **stable call id** on both the status and recording
   webhooks? (The code needs it to make webhook delivery idempotent —
   `CrmActivity.providerEventId` already carries a unique index for it.)
2. How long do **recording URLs** stay valid? (Ours are downloaded to S3
   immediately regardless; the answer sets how urgent the retry is.)
3. Is **number masking** included, and does the customer see the same number
   every time? (A different number per call teaches customers not to pick up.)
4. What is the **webhook retry policy** on non-2xx?
5. Is there a **sandbox** with test numbers before KYC clears? (This decides
   whether the code can be built while the paperwork is in flight — usually
   yes, and it is the difference between four weeks and five.)
6. **On an inbound call, when does the webhook fire — before the agent's phone
   rings, or after?** And how many seconds ahead?

   This is the question the whole screen-pop depends on, and it is the kind
   that is discovered late. The point of the pop is that the agent sees who is
   calling *before* they pick up; a webhook that arrives after the phone has
   already rung leaves them answering blind and then reading a record that
   appeared while they were talking. Ask for the number, in seconds, and ask
   whether it is the same on a busy account. If the answer is "on answer" or
   "after", the feature has to be redesigned around a different event — and
   that is a thing to know in week one, not week five.

### Recording consent — configure at provisioning, not in code

Announcing that a call is recorded is a **legal requirement in India**, and it
is configured **on the Exotel number/flow, not in this application**. The
announcement plays before the parties are bridged; nothing in our code sits
early enough in the call to do it.

Set it up **while the number is being provisioned**. Retro-fitting it means
every call recorded in between was taken without disclosure — those recordings
are not made lawful afterwards by turning the announcement on, and the only
clean remedy is deleting them.

Ask Exotel to enable the announcement on the App/flow attached to the number,
in the languages the market needs, and confirm it plays on **inbound as well as
outbound** — the two are configured separately and outbound is the one usually
forgotten.

---

## 3. Environment variables to reserve

Not implemented yet — listed so the names are settled before three files
disagree about them.

```
# WhatsApp (Meta Cloud API)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_TOKEN=
WHATSAPP_VERIFY_TOKEN=

# Telephony
TELEPHONY_PROVIDER=exotel        # exotel | twilio
TELEPHONY_SID=
TELEPHONY_TOKEN=
TELEPHONY_CALLER_ID=             # the masked number customers see
TELEPHONY_WEBHOOK_SECRET=

# Recording storage — reuses the S3 bucket the app already has
S3_RECORDINGS_PREFIX=crm/recordings/
```

`META_*` for Lead Ads is already live and separate; the WhatsApp credentials
are a different product inside the same Business Manager and do not replace it.

---

## 4. Data the customer can demand back

Under the DPDP Act a customer can ask to be deleted, and the request covers
**everything derived from them**, not just the record with their name on it. A
transcript is their words; a recording is their voice; an activity row is a log
of what they said. Deleting the contact and leaving those behind satisfies
nobody and is worse than not having a policy, because it looks like compliance.

Work this out now. The first request arrives with a clock attached, and
figuring out where the data lives while that clock runs is how things get
missed.

### Mongo — what a deletion has to touch

| Collection | What is in it | Match on |
|---|---|---|
| `leads` | The enquiry, phone, email, message, UTM | `_id` |
| `contacts` | The person | `_id` |
| `companies` | Their business — **usually keep** | see note |
| `deals` | Value, notes, lost reason | `lead`, `contact` |
| `crmactivities` | Calls, messages, notes, **recording keys, transcripts** | `entityType` + `entityId` |
| `crmtasks` | Follow-ups, and their notes quoting the customer | `entityType` + `entityId` |
| `crmnotes` | Free text about them | `relatedType` + `relatedId` |
| `notifications` | Titles that quote the record's name | `link` containing the id |
| `jobs` (Agenda) | Queued payloads may carry their phone or lead id | `data` |
| `deals_legacy` | Archived pre-pipeline deals — **easy to forget** | `lead` |

Two that are genuinely optional, and should be decided as policy rather than
per request:

- **`companies`** — a company is usually a separate legal person, not the
  individual making the request. Deleting it removes other people's data.
  Default: keep, and delete only if the company *is* the individual.
- **Aggregates.** Counters and reports that no longer identify anybody
  (revenue by month, deals lost by reason) are normally out of scope. Anything
  still carrying a name or a number is not.

### S3 — what a deletion has to touch

```
crm/recordings/<callId>.mp3        ← call recordings
crm/transcripts/<callId>.json      ← once §10.1 (transcription) lands
```

Recording keys live on `crmactivities.meta.recordingKey`, so the activity rows
are what tell you which objects to delete. **Delete the S3 objects first, then
the rows** — done the other way round, a failure halfway leaves objects nobody
can find any more.

Note that S3 delete is not immediate everywhere: versioned buckets keep a
delete marker, and the old version survives until the lifecycle rule removes
it. If the bucket is versioned, the deletion routine must delete **all
versions**, not just the current one.

### Write the routine when the feature ships

Each channel adds a place customer data lives. The rule that keeps this
manageable: **the pull request that starts storing something adds it to the
deletion routine in the same change.** A deletion path written later is written
from memory, and memory is exactly what fails here.

### Retention — a lifecycle rule on day one

Recordings are the largest thing this system will ever store and the least
looked at. Without a rule they accumulate for ever, and the bill that follows
in year two belongs to nobody.

Put an S3 lifecycle rule on the prefix **when the bucket is first pointed at
it**, not after the first invoice:

```
prefix: crm/recordings/
  → Glacier Instant Retrieval after 90 days
  → delete after 365 days
```

Ninety days is roughly how long a recording is genuinely useful — a dispute or
a coaching review happens inside a quarter or not at all. One year is a
defensible retention period for a sales call; if legal wants longer, they
should say so and own the cost. Whatever is chosen, it must be **written down
here and in the privacy notice**, because "we keep recordings for X" is a
statement the customer is entitled to.

The transcripts are small and cheap by comparison, but they are the *readable*
copy of the same conversation — so they inherit the same retention period, not
a longer one.

---

## 5. Build order once access exists

1. **Telephony** — click-to-call, recording → S3, and the inbound screen-pop.
2. **WhatsApp** — templates out, inbound in, opt-in enforced on every send.
3. **Email** — start with the BCC dropbox. It is a day's work and answers
   whether email tracking gets used at all, before anyone builds OAuth for it.

The inbound screen-pop is first among equals. Everything else on this list
saves an agent time; the screen-pop is the one feature that makes them keep the
CRM open all day, and an unopened CRM is one with untrue data in it.
