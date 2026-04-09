# AGENTS.md - Unworked Gold Session Memory Protocol

## Purpose
This repository uses a strict memory/brief workflow so context is not lost between chats.

## Mandatory startup actions (every new session)
1. Read `project_memory_backbone_2026_04_09.md`.
2. Read the latest master brief provided by the user.
3. Read the current target file(s) for the session.
4. Confirm one concrete session goal before making edits.

## Session modes
- **Build session**: implement code/docs changes, test appropriately, then checkpoint and close.
- **Planning session**: research/options/tradeoffs first, no unintended code edits.

## Checkpoint trigger
If the user says words like "checkpoint", "log it", "update brief", "capture this", or asks for status memory:
- Immediately update memory artifacts in-repo before continuing.
- Never wait for chat end if the user requests capture now.

## End-of-session required outputs
At the end of each meaningful work session, always provide and/or update:
1. Completed items (what actually shipped/decided),
2. Current TODO list,
3. Unexplored/lost brainstorm items,
4. A dated amendment file in repo root:
   - `brief_amendment_YYYY_MM_DD_<topic>.md`
5. Git commit and push with a clear commit message.

## Canonical continuity files
- Primary continuity backbone: `project_memory_backbone_2026_04_09.md`
- Amendment files: `brief_amendment_*.md`

## Merge safety rules
- Do not overwrite newer decisions with older snapshots.
- Preserve chronology: newer approved decisions are canonical unless explicitly reopened.
- Append/amend; do not delete historical decision context unless user explicitly requests cleanup.

## Product principles to preserve
- Beginner-first clarity.
- Field usability.
- Best-of-the-best, no shortcuts.
- Research/options/tradeoffs before major architecture choices.

