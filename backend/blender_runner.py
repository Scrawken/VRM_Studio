"""Blender detection and hardened background subprocess execution module."""

import json
import os
import platform
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

SHELL_META_RE = re.compile(r"[;&|`$<>!?\n\r\0]")


@dataclass
class BlenderInfo:
    installed: bool
    executable_path: Optional[str] = None
    version: Optional[str] = None
    platform_name: str = field(default_factory=lambda: f"{platform.system()} {platform.machine()}")
    searched_paths: List[str] = field(default_factory=list)
    error: Optional[str] = None


def is_trusted_blender_executable(candidate: str) -> bool:
    if not candidate or SHELL_META_RE.search(candidate) or ".." in candidate:
        return False
    p = Path(candidate)
    if not p.is_absolute():
        return False
    system = platform.system()
    if system == "Windows":
        if p.name.lower() != "blender.exe":
            return False
    else:
        if p.name != "blender":
            return False
    return True


def repo_tool_blender_paths(tools_root: Optional[Path] = None) -> List[str]:
    """Portable installs under <repo>/_tools/blender-*/[<nested>/]blender(.exe); 4.2 first, then newest."""
    if tools_root is None:
        # <repo>/_tools, also found from a git worktree under <repo>/_staging/<name> (up to 3 ancestors).
        tools_root = Path(__file__).resolve().parent.parent / "_tools"
        for anc in list(Path(__file__).resolve().parents)[1:4]:
            if (anc / "_tools").is_dir():
                tools_root = anc / "_tools"
                break
    root = tools_root
    exe = "blender.exe" if platform.system() == "Windows" else "blender"
    found: List[Path] = []
    try:
        for d in root.iterdir():
            if not d.is_dir() or not d.name.lower().startswith("blender-"):
                continue
            found.append(d / exe)
            found.extend(sub / exe for sub in d.iterdir() if sub.is_dir())
    except OSError:
        return []

    def rank(p: Path) -> int:
        m = re.search(r"blender-(\d+)\.(\d+)", str(p), re.I)
        if not m:
            return -1
        v = int(m.group(1)) * 100 + int(m.group(2))
        return 10**9 if v == 402 else v

    return [str(p) for p in sorted((p for p in found if p.is_file()), key=rank, reverse=True)]


def candidate_blender_paths() -> List[str]:
    candidates: List[str] = []
    env_path = os.environ.get("BLENDER_EXECUTABLE", "").strip()
    if env_path and is_trusted_blender_executable(env_path):
        candidates.append(env_path)

    candidates.extend(repo_tool_blender_paths())

    system = platform.system()
    if system == "Windows":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        for base in (pf, pf86):
            # 4.2 first (acceptance target); newer builds also via BLENDER_EXECUTABLE.
            for ver in ("4.2", "5.2", "5.1", "5.0", "4.5", "4.4", "4.3", "4.1", "4.0", "3.6"):
                candidates.append(str(Path(base) / "Blender Foundation" / f"Blender {ver}" / "blender.exe"))
    elif system == "Darwin":
        candidates.extend([
            "/Applications/Blender.app/Contents/MacOS/Blender",
            "/usr/local/bin/blender",
        ])
    else:
        candidates.extend([
            "/usr/bin/blender",
            "/usr/local/bin/blender",
            "/snap/bin/blender",
        ])
    return candidates


def detect_blender() -> BlenderInfo:
    searched: List[str] = []
    for candidate in candidate_blender_paths():
        searched.append(candidate)
        if not is_trusted_blender_executable(candidate) or not Path(candidate).is_file():
            continue
        try:
            proc = subprocess.run(
                [candidate, "--version"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip().lower().startswith("blender"):
                first_line = proc.stdout.strip().splitlines()[0].strip()
                return BlenderInfo(
                    installed=True,
                    executable_path=candidate,
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
        error="No verified Blender executable found in trusted installation paths.",
    )


def run_blender_script(
    blender_executable: str,
    script_path: str,
    extra_args: Optional[List[str]] = None,
    timeout_sec: int = 120,
) -> dict:
    if not is_trusted_blender_executable(blender_executable) or not Path(blender_executable).is_file():
        raise PermissionError(f"Rejected untrusted or missing Blender executable: {blender_executable}")
    if not Path(script_path).is_file():
        raise FileNotFoundError(f"Blender Python script not found: {script_path}")

    cmd = [blender_executable, "--background", "--python-exit-code", "1", "--python", script_path]
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
