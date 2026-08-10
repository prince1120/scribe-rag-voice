# Traps this codebase has already fallen into

Each of these cost real debugging time. They are recorded because the symptom
never pointed at the cause, and because most of them will bite again in a new
file if nobody knows.

## PostgreSQL: `mode` is a reserved function name

A column named `mode` fails at **select** time, not create time:

```
WrongObjectTypeError: WITHIN GROUP is required for ordered-set aggregate mode
```

Postgres parses a bare `mode` as its built-in ordered-set aggregate
`mode() WITHIN GROUP`. The table creates without complaint, then every read
explodes with an error mentioning `WITHIN GROUP`, which points nowhere near a
column name.

**Both places this bit us** now map to a different DB column while keeping the
Python attribute:

```python
mode: Mapped[str] = mapped_column("access_mode", String(16), default="both")     # contacts
mode: Mapped[str] = mapped_column("workspace_mode", String(16), default="personal")  # owners
```

Other names worth avoiding: `user`, `order`, `group`, `check`, `default`.

## Secure-context APIs are absent, not just blocked

On a plain-HTTP origin (`http://192.168.1.5:3000`) browsers **delete** these
APIs rather than denying them:

- `navigator.mediaDevices` — so `getUserMedia` throws
  `Cannot read properties of undefined`, deep inside whatever SDK touched it
- `crypto.randomUUID` — throws `is not a function`

The second one broke *chat* after a change that had nothing to do with
security, because message ids used `crypto.randomUUID()`. Existing code in the
same file already guarded it; the new code did not.

**Rule:** anything under `crypto`, `navigator.mediaDevices`, or
`navigator.clipboard` needs a fallback, or the feature is desktop-and-HTTPS
only. `localhost` counts as secure; a LAN IP does not.

## Next.js blocks LAN origins from dev assets

Opening the dev server from a phone on the same Wi-Fi shows the
server-rendered HTML and then nothing — React never hydrates, so a loading
state sits there forever. It reads as a hung backend. The backend is fine.

Next prints the reason once and it is easy to miss:

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr
```

Fix in `next.config.ts` → `allowedDevOrigins`. Private ranges are listed there.

## `set_cookie` and `cookie_params()`

`cookie_params()` returns `key` along with the flags. Passing the cookie name
positionally as well produces:

```
TypeError: got multiple values for argument 'key'
```

…which surfaces as a 500 on every link open. Use `value=` and spread the rest:

```python
response.set_cookie(value=issue(...), max_age=..., **cookie_params())
```

## A default value cannot express "not answered"

`mode` defaulting to `"personal"` made a deliberate choice indistinguishable
from an unanswered question, so the Personal-or-Business prompt could either
never appear or appear forever. A nullable `mode_chosen_at` carries the answer;
the mode carries only what was chosen.

Generally: when a question must be asked *exactly once*, the answer needs its
own field. A sentinel value in the answer column will not do it.

## SQLAlchemy `create_all` does not ALTER

New columns on an existing table are silently ignored — the app starts, then
fails on the first query mentioning them. Until Alembic is wired up, new
columns need an explicit statement:

```sql
ALTER TABLE owners ADD COLUMN IF NOT EXISTS email VARCHAR(320);
```

## A package and a module cannot share a name

`app/repositories.py` and `app/repositories/` cannot coexist. Converting the
module to `app/repositories/__init__.py` keeps every `from app import
repositories` call site working while allowing `repositories/owners.py`
alongside it.

## Hooks must sit above every early return

`useDrawer` was placed after `if (!mounted) return`, so hook order changed
between the first render and the rest. React's lint catches it; the runtime
symptom would have been far stranger.

## SSE must be parsed per line, not per chunk

A network chunk can end mid-frame. Parsing each chunk independently silently
drops whichever token straddled the boundary — the answer is subtly wrong and
nothing errors. Buffer, split on newline, and keep the trailing partial line
for the next read.

## Streaming errors cannot be raised

Once an SSE response has started, the status is already 200. Raising just drops
the connection, and the client waits forever behind a spinner. Emit an error
frame and `[DONE]` instead — and persist whatever text the user already saw, so
the stored transcript matches the screen.
