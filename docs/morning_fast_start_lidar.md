# Morning Fast-Start: Pendleton LiDAR Overnight Run

This is a zero-friction launch checklist for starting a long LiDAR job quickly.

## 1) Pull latest branch state

Run:

- `git checkout cursor/inline-pro-gate-date-label-d9fb`
- `git pull origin cursor/inline-pro-gate-date-label-d9fb`

## 2) Quick preflight

Run:

- `bash scripts/lidar_preflight.sh`

If anything is missing, install/fix only that dependency and rerun preflight.

## 3) Pick your overnight command

Use your known-good pipeline command (same one you were running with Claude), then launch it inside a persistent tmux session:

- `bash scripts/start_overnight_job.sh "<YOUR_PIPELINE_COMMAND>"`

Examples (replace with your real command):

- `bash scripts/start_overnight_job.sh "python3 lidar_pipeline.py --aoi indiana/pendleton --styles hillshade,svf,slope,lrm,rrim,north,northeast,east,southeast,lowangle"`
- `bash scripts/start_overnight_job.sh "bash run_pendleton_lidar.sh"`

## 4) Check job status/logs

Run:

- `bash scripts/check_overnight_job.sh`

This shows:

- tmux session status
- current command state
- log file tail

## 5) Important note on coverage issue

Style stacking in `index.html` is now code-ready, but Pendleton coverage quality still depends on the tile-generation job output. If you still see partial strip coverage, the data/pipeline output for that AOI must be rerun/fixed.
