# E1 benchmarks

`mesh_stats.py` parses GLB2 containers (including VRM files, which are GLB2) and writes computed geometry/material/texture/skin/morph statistics.

`deform_bench.py` is a Blender 4.2 headless Workbench benchmark. It imports a `.glb`, renders front/side/face/back views, applies fixed joint rotations, and writes JSON metrics. Use copies of source assets; never modify `projects/*` originals. `.vrm` import requires the `io_scene_vrm` add-on in the portable Blender installation. The supplied runtime lacked that add-on, so E1 runtime evidence uses the identical GLB payload and records the limitation.

The report is `REPORT.md`; rendered evidence and JSON outputs are under `assets/` and `benchmarks/` respectively. Unreal/VRM4U is covered by the untested acceptance protocol in `../docs/UNREAL_VRM4U_CHECKLIST.md`.

All thresholds in the report are proposals, not product requirements.
