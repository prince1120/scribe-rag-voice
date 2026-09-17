# UI review and responsive handoff

Theme: retain cream surfaces, indigo actions, existing typography and icon families.

## Implemented in this pass

- Owner console: product detail routes retain Products & QRs navigation context; mobile drawer traps focus, closes with Escape, restores focus, and disables background interaction.
- Mobile console: 44px controls, larger navigation targets, horizontally scrolling Inbox tabs, stacked headers, readable form text, safe-area spacing.
- Shared surfaces: keyboard focus indicators, balanced headings, bounded form widths, scrollable support modal on short screens.
- Voice screen: available-height layout replaces a viewport calculation that ignored status banners; flexible desktop columns and smaller mobile control spacing; brief entrance motion honoring reduced-motion preferences.
- Inbox: consistent request spacing and card boundaries; long content wraps.
- Landing: unsupported latency, phone-call, and guaranteed-recording claims replaced; simulated conversation identified as an example.
- Directory: labeled search, retry action, and distinct failure/empty states.

## Screen coverage and next visual checks

| Surface | Review | Next check with backend available |
|---|---|---|
| Homepage | Existing motion/layout reviewed; copy corrected | Mobile hero, scenario controls and directory data |
| Sign-in | Desktop screenshot and phone viewport reviewed | Validation and account creation |
| Setup | Shared form behavior updated | Long business names and category selection |
| Overview | Shared owner spacing/navigation updated | Populated metrics and empty workspace |
| Assistant / My Agents | Shared owner/form behavior updated | Website import, manual creation, document upload, long prompts |
| Inbox | Shared request/tab styling updated | Support request editing, status filters, notification links |
| Calendar | Shared owner/form behavior updated | Week view and booking editor at 390px and tablet width |
| People & Calls | Shared owner behavior updated | Long contact names, pagination, transcripts |
| Account & Keys | Shared forms updated | Save errors, key visibility controls and successful persistence |
| Products / product detail | Nested navigation fixed, shared sizing updated | Registration, manual assignment, QR actions |
| Public Product QR | Shared forms/modal sizing updated | Chat composer, safety escalation and support dialog |
| Web call | Grid/control sizing updated | Listening, speaking, warning banner, transcript drawer, ended state |
| Directory | Mobile viewport inspected; failure presentation fixed | Populated cards and connection dialog |
| Invite links / personal chat | Existing styles inventoried; shared focus/input rules | Entry form and composer with mobile keyboard |
| Privacy / Terms / 404 | Existing routes retained | Reading width and return navigation |

## Verification limits

Production build passed after shared layout and landing changes. Final directory retry change receives a TypeScript check. Sign-in and directory were inspected at a 390px viewport. No authenticated, populated console or microphone workflow was verified: the backend was unavailable. CSS updates are not proof that every device and application state is verified.

## Retention priorities

### Follow-up implementation

- Overview now includes four practical links: configure the assistant, attach knowledge, test, and share. Product QR setup has a separate entry.
- Restored the existing AgentTest component in the Assistant editor, using the backend-provided channel availability and blocked reasons.
- Added real anchor destinations for knowledge and testing, plus responsive four/two/one-column guide layouts and reduced-motion-aware hover feedback.
- No fabricated completion percentages or inferred completion from clicks. Live testing remains pending while the backend is offline.

1. Keep the next useful action visible: create an assistant, attach knowledge, test it, share the link.
2. Show real outcomes in Overview once available: questions answered and requests awaiting follow-up.
3. Preserve user input on errors and explain how to recover.
4. Favor short feedback animations over continuous motion in work screens.
5. Measure successful first-assistant setup and repeat usage before claiming design improves retention.
