# E3 corrected benchmarks

`mesh_stats.py` parses GLB2 containers (including VRM files, which are GLB2) and writes computed geometry/material/texture/skin/morph statistics.

`deform_bench_v2.py` is the corrected Blender 4.2 headless benchmark. Run Blender without `--factory-startup`; the portable install provides VRM Format 4.10.5 as `bl_ext.user_default.vrm`. The script imports both `.vrm` and `.glb`, selects a valid local pose axis by verifying descendant motion, measures vertices weighted >0.3 to the target or descendants, reports per-mesh baseline/posed degenerate faces and weights, and runs a synthetic two-bone control. Use read-only source assets or copies; never modify `projects/*` originals.

`degenerate_report.py` maps pre-fix zero-area triangles to GLB primitives, indices and positions. `src/shared/sculptorGeometry.test.ts` is the generator regression test; it also checks attribute alignment after triangle/topology changes.

All thresholds in the report are proposals, not product requirements.
