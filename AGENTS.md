## Cursor Cloud specific instructions

- Do not create demo videos or screen recordings unless the user explicitly asks for one.
- Prefer terminal-based validation for non-visual changes.

## User workflow defaults

- Default to FAST SHIP mode: concise communication, direct execution, minimal process chatter.
- If the user says "push", treat it as push to `main` for live deployment unless they explicitly say `PR only`.
- If the user asks for a PR, create one PR per meaningful batch instead of fragmented micro-updates.
- Ask at most one blocking clarification question at a time.
- If blocked on missing assets/files, give one exact upload path or URL and wait for confirmation.
- Do not assume external environment details (like DB state); state uncertainty clearly and proceed with safe, scoped changes.
