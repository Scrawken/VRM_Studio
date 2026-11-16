"""FastAPI desktop backend entrypoint for VRM Forge Studio."""

from dataclasses import asdict
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from blender_runner import detect_blender, run_blender_script
from providers import get_provider_catalog
from vrm_validator import validate_vrm_bytes

app = FastAPI(title="VRM Forge Studio Desktop Backend", version="1.0.0")


class BlenderDetectRequest(BaseModel):
    custom_path: Optional[str] = None


class BlenderRunRequest(BaseModel):
    blender_path: Optional[str] = None
    out_dir: str = "./projects/_blender_test"


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "vrm-forge-fastapi"}


@app.get("/api/providers")
def providers():
    return {"providers": get_provider_catalog()}


@app.post("/api/blender/detect")
def api_detect_blender(req: BlenderDetectRequest):
    return asdict(detect_blender(req.custom_path))


@app.post("/api/blender/test-milestone2")
def api_run_milestone2(req: BlenderRunRequest):
    info = detect_blender(req.blender_path)
    if not info.installed or not info.executable_path:
        raise HTTPException(status_code=400, detail=info.error or "Blender not detected.")
    script_path = str(Path(__file__).resolve().parent.parent / "blender_scripts" / "test_milestone2_blender.py")
    return run_blender_script(info.executable_path, script_path, ["--out-dir", req.out_dir])


@app.post("/api/vrm/validate-file")
def api_validate_file(path: str):
    target = Path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="VRM file not found.")
    return validate_vrm_bytes(target.read_bytes())
