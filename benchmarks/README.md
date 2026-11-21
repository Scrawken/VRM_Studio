# E3 corrected benchmarks

`mesh_stats.py` parses GLB2 containers (including VRM files, which are GLB2) and writes computed geometry/material/texture/skin/morph statistics.

`deform_bench_v2.py` is the corrected Blender 4.2 headless benchmark. Run Blender without `--factory-startup`; the portable install provides VRM Format 4.10.5 as `bl_ext.user_default.vrm`. The script imports both `.vrm` and `.glb`, selects a valid local pose axis by verifying descendant motion, measures vertices weighted >0.3 to the target or descendants, reports per-mesh baseline/posed degenerate faces and weights, and runs a synthetic two-bone control. Use read-only source assets or copies; never modify `projects/*` originals.

The report is `REPORT.md`; corrected JSON outputs are `*_deform_v2.json`. Prior E1 renders remain under `assets/`. Unreal/VRM4U is covered by the acceptance protocol in `../docs/UNREAL_VRM4U_CHECKLIST.md` and remains untested.

All thresholds in the report are proposals, not product requirements.
