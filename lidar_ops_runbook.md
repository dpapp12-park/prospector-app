# LiDAR Ops Runbook (Fast Ship)

Goal: maximize unattended throughput while minimizing manual check-ins and preventing storage blowups.

## 0) Core operating mode

Run state-atomic loops, not phase-atomic loops:

1. Download state inputs
2. Validate completeness
3. Process derivatives
4. Build tiles
5. Upload to live keys
6. Quick visual verify
7. Cleanup local raw/temp
8. Mark complete
9. Continue to next state

If one project/state fails:
- log failure
- continue to next item
- revisit failures in a dedicated retry pass

Do not stop the entire pipeline on single-item errors.

## 1) Access hardening (avoid short token interruptions)

Preferred control-plane auth for automation:
- IAM user access key with least-privilege policy for EC2 + SSM + S3 operations used by pipeline.

Session-token exports from CloudShell are acceptable for ad-hoc interventions, but not ideal for long orchestration windows.

## 2) Worker architecture

- Primary worker: current 500GB instance (`i-0d84956aaff1d6263`).
- Add at least one additional worker for parallel state execution.
- Use SSM for remote command execution (no SSH/IP fragility dependency).

Suggested split:
- Worker A: WY -> MT -> ID
- Worker B: NV -> UT -> CO
- Worker C (optional): AZ -> NM -> OR/WA catch-up

Adjust by observed throughput/disk pressure.

## 3) Data source and naming reality

Do not rely only on `USGS_LPC_<STATE>_` prefix naming.
Use manifest discovery that supports:
- `USGS_LPC_<STATE>_*`
- `<STATE>_*` (newer project naming)

Without this, coverage is incomplete.

## 4) Storage guardrails

Per worker:
- Hard stop threshold: free disk < 15%
- Warning threshold: free disk < 25%
- Must cleanup raw/temp after successful upload+verify before next state

This prevents local exhaustion and keeps loop stable.

## 5) Publish strategy (your chosen policy)

You approved overwrite/no-duplicate mode:
- publish new tiles directly to live paths/keys
- no parallel version trees
- delete obsolete legacy paths after successful verification

This minimizes storage usage.

## 6) Standard state loop checklist

For each state:
1. Build state manifest
2. Download each project in state with retry/backoff
3. Validate counts/bytes against source
4. Process style stack (10 styles or configured subset)
5. Tile build (z/x/y)
6. Upload to target keyspace
7. CDN/path verify in app
8. Cleanup local source/intermediates
9. Mark state complete

## 7) Failure handling policy

Types and behavior:

- Download/transient network error:
  - retry with capped backoff
  - continue after retries exhausted (mark failed)

- Processing error (bad input tile/project):
  - isolate project
  - mark failed
  - continue next project/state

- Upload error:
  - retry upload
  - if still failing, mark failed and continue

- Verification failure:
  - mark failed (do not cleanup raw yet if rerun needed)
  - continue next item

## 8) Minimal check-in commands (SSM)

Use these for occasional status checks:

- Process status:
  - `ps -ef | rg 'state_worker|aws s3 sync|pdal|gdal|tippecanoe'`

- Disk status:
  - `df -h / /data`

- Progress logs:
  - `tail -n 80 /data/lidar/logs/state_worker.log`
  - `tail -n 80 /data/lidar/logs/current_state.log`

- Top storage consumers:
  - `du -sh /data/lidar/* | sort -h | tail -n 20`

## 9) State priority order (launch-first bias)

Initial order for western completion push:

1. Wyoming
2. Montana
3. Idaho
4. Oregon
5. Nevada
6. Utah
7. Colorado
8. Arizona
9. New Mexico
10. Washington
11. California

Then expand to full USA manifest-driven execution.

## 10) Definition of done

State is done only when:
- all discovered projects for that state are either `completed` or explicitly `failed` with reason
- uploaded tiles verified in live map path
- local raw/temp cleaned
- manifest updated

