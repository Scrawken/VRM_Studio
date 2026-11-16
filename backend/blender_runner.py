"""Blender detection and background subprocess execution module."""

import json
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


@dataclass
class BlenderInfo:
    installed: bool
    executable_path: Optional[str] = None
    version: Optional[str] = None
    platform_name: str = field(default_factory=lambda: f"{platform.system()} {platform.machine()}")
    searched_paths: List[str] = field(default_factory=list)
    error: Optional[str] = None


def candidate_blender_paths(custom_path: Optional[str] = None) -> List[str]:
    candidates: List[str] = []
    if custom_path and custom_path.strip():
        candidates.append(custom_path.strip())

    env_path = os.environ.get("BLENDER_EXECUTABLE")
    if env_path:
        candidates.append(env_path)

    system = platform.system()
    if system == "Windows":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        for ver in ("4.3", "4.2", "4.1", "4.0", "3.6"):
            candidates.append(str(Path(pf) / "Blender Foundation" / f"Blender {ver}" / "blender.exe"))
        candidates.append("blender.exe")
    elif system == "Darwin":
        candidates.extend([
            "/Applications/Blender.app/Contents/MacOS/Blender",
            "/usr/local/bin/blender",
            "blender",
        ])
    else:
        candidates.extend([
            "/usr/bin/blender",
            "/usr/local/bin/blender",
            "/snap/bin/blender",
            "blender",
        ])
    return candidates


def detect_blender(custom_path: Optional[str] = None) -> BlenderInfo:
    searched: List[str] = []
    for candidate in candidate_blender_paths(custom_path):
        searched.append(candidate)
        resolved = shutil.which(candidate) if not Path(candidate).is_absolute() else candidate
        if not resolved or not Path(resolved).exists():
            continue
        try:
            proc = subprocess.run(
                [resolved, "--version"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                first_line = proc.stdout.strip().splitlines()[0].strip()
                return BlenderInfo(
                    installed=True,
                    executable_path=resolved,
                    version=first_line,
                    searched_paths=searched,
                )
        except (OSError, subprocess.SubprocessError) as exc:
            return BlenderInfo(
                installed=False,
                searched_paths=searched,
                error=str(exc),
            )
    return BlenderInfo(
        installed=False,
        searched_paths=searched,
        error="No Blender executable found in candidate paths.",
    )


def run_blender_script(
    blender_executable: str,
    script_path: str,
    extra_args: Optional[List[str]] = None,
    timeout_sec: int = 120,
) -> dict:
    if not Path(blender_executable).exists():
        raise FileNotFoundError(f"Blender executable does not exist: {blender_executable}")
    if not Path(script_path).exists():
        raise FileNotFoundError(f"Blender Python script not found: {script_path}")

    cmd = [blender_executable, "--background", "--python", script_path]
    if extra_args:
        cmd.append("--")
        cmd.extend(extra_args)

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )

    parsed_report = None
    for line in proc.stdout.splitlines():
        if line.startswith("MILESTONE2_REPORT:") or line.startswith("VRM_FORGE_REPORT:"):
            raw_json = line.split(":", 1)[1]
            try:
                parsed_report = json.loads(raw_json)
            except json.JSONDecodeError:
                parsed_report = None

    return {
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "report": parsed_report,
    }
