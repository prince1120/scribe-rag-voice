# Who is who, and how we know

Three kinds of people use Scribe, and each is identified differently. Getting
this wrong is the difference between a private library and a public one, so
this document explains not just the mechanism but why each choice was made.

## The three identities

| | Identified by | Signs in? |
|---|---|---|
| **Personal user** | A tenant id derived from their own API keys | No |
| **Business owner** | The same tenant, plus an optional email + password | Optionally |
| **Caller** | An invite token exchanged for a signed cookie | Never |

### Why personal users do not sign in

Bringing your own API keys *is* the account creation step. The tenant id is a
hash of those keys, so the same keys always reach the same workspace, and no
two people can collide. Asking someone to also register would be asking for a
credential twice, and would give us a password to store for no benefit.

### Why business owners can

An owner needs to check what their agent said, daily, possibly on a phone that
is not the one they set it up on. Re-pasting a long API key each time is worse
than a password — it is longer, more sensitive, and more likely to be copied
somewhere insecure. So an owner may attach an email and password to the
workspace they already have.

This is **not a signup**. The workspace exists first; the password is a second
way back into it.

### Why callers never sign in

A caller holds a link and nothing else. The whole point is that a customer can
tap a WhatsApp message and start talking. Any form at that moment defeats it.

## How sessions work

All three use the same signed cookie, `scribe_session`, and the payload's
`kind` decides what it grants:

```
kind = "owner"                        the original single-passcode session
kind = "owner:<tenant_id>"            a business owner who signed in
kind = "contact:<id>:<owner_tenant>"  a caller, scoped to one owner
```

**The signature alone proves nothing about privilege.** Every one of these is
signed with the same key, so `resolve_identity` must read `kind` and act on it.
This was a real bug: an earlier version accepted any validly signed cookie as
the owner, which meant an invite link carried the right to delete the documents
it could read. See `app/identity.py`.

The tenant travels **inside** the signed payload rather than being looked up.
Two reasons: resolving identity stays synchronous with no database round trip
on every request, and a caller cannot edit the value to reach another owner's
workspace without invalidating the signature.

## Password storage

`hashlib.scrypt`, from the standard library.

```
scrypt$<salt_hex>$<hash_hex>
```

- **scrypt, not bcrypt or argon2** — memory-hard, in the stdlib, and adds no
  dependency to a project that already does its signing with stdlib `hmac`.
- **n=2^14, r=8, p=1** — the "interactive login" profile from the scrypt paper.
  Roughly 100ms and 16MB per verification: slow enough that offline cracking is
  expensive, fast enough that nobody notices at a login screen.
- **Per-password salt** — two owners who choose the same password get different
  stored values, so cracking one reveals nothing about the other.
- **The scheme is recorded in the string** so a future migration can re-hash on
  next login rather than locking everyone out.

### Password rules

Length only, minimum 8. Composition requirements (a digit, a symbol, a capital)
reliably push people toward `Password1!` — predictable, and weaker than a long
passphrase. Length is the property that actually resists guessing.

## Login endpoint protections

`POST /api/v1/workspace/login` is the one endpoint where guessing pays, so:

1. **Rate limited to 5/minute per IP.**
2. **Identical failure message** for an unknown email and a wrong password, so
   the endpoint cannot be used to discover which businesses have accounts.
3. **A hash is computed even when the account does not exist**, so a missing
   account and a wrong password take the same time. Without this, response
   timing reveals which emails are registered.
4. **Emails are normalised** (trimmed, lowercased) before lookup, so
   `Prince@X.com ` and `prince@x.com` are one account rather than two.

## Invite links

A link is a **bearer credential**: whoever holds it is that person. Forwarded
into a WhatsApp group, it is gone. That cannot be designed away, so the damage
is bounded instead:

| Measure | What it stops |
|---|---|
| Only the token's SHA-256 is stored | A database leak yields no working links |
| First device to open a link claims it | A forwarded link is useless to the recipient |
| Instant revoke | Retires a link |
| Block | Refuses the person, keeps their link and history |
| Optional PIN, delivered separately | One leaked channel is not enough |
| Per-day session caps | A leaked link cannot drain an LLM quota unnoticed |
| Session log with IP and device | A spread link becomes visible |

Tokens are `secrets.token_urlsafe(32)` — 256 bits. Guessing is not a threat
worth modelling; the rate limit on `/contacts/open` is belt and braces.

**Block and revoke return the same message to the caller.** The person on the
other end does not need to know which lever was pulled.

## What a caller may and may not do

A caller reaches the API with a valid session cookie scoped to the owner's
tenant, so they can read what the agent reads. They must never be able to
change it. `Identity.can_manage_documents` is false for contacts and is checked
on all four mutating document routes. Without that check, an invite link would
carry the right to delete every document it could see.

## Open issues

- Owner passwords have no reset flow. Losing one means losing the workspace
  unless the original API keys are still to hand.
- There is no session revocation list. Changing `SESSION_SECRET` signs everyone
  out, which is the only lever today.
- The device id derived for link binding uses user agent and IP, both of which
  are spoofable by anyone already holding the link. It is a tripwire for "this
  link has spread", not a security boundary.
