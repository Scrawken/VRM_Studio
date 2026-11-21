# U3 final Unreal/VRM4U retry evidence

U3 was the final bounded attempt to diagnose the inconclusive rendered-editor route. No engine files were modified; the plugin remained project-local. Fresh project and inputs were under `F:/Projects/vrm-forge-studio/_staging/tmp/u3`.

## Approach changes

- Added absolute file-backed markers in `progress.log` and `result.json`.
- Retained the `register_slate_post_tick_callback` handle.
- Waited for 120 ticks before invoking `AssetImportTask`, rather than importing immediately.
- Tried the rendered editor without `-unattended`.
- Tried the project `PythonScriptPlugin` `StartupScripts` setting so the script could run after editor startup.
- The final startup-script syntax was corrected from a malformed tuple-like value to `StartupScripts=("F:/.../u3_final.py")`.

## Commands and outcomes

### Rendered editor with ExecutePythonScript

```text
UnrealEditor.exe .../VRM4UTest.uproject -nop4 -nosplash -NoSound \
  -ExecutePythonScript=.../u3_final.py
```

The command line was present in the log, but the script only wrote `script_started`, `callback_registered`, and `tick_wait` at tick 1. It never reached tick 120, never wrote an import result, and the editor window was destroyed. Retaining the callback handle did not change this. Evidence: `F:/Projects/vrm-forge-studio/_staging/tmp/u3/progress.log` and `.../VRM4UTest/Saved/Logs/VRM4UTest.log`.

### Project startup script

Project config:

```ini
[/Script/PythonScriptPlugin.PythonScriptPluginSettings]
bDeveloperMode=True
StartupScripts=("F:/Projects/vrm-forge-studio/_staging/tmp/u3/VRM4UTest/u3_final.py")
```

Command:

```text
UnrealEditor.exe .../VRM4UTest.uproject -nop4 -nosplash -NoSound
```

The log confirms the startup script was discovered and executed as a startup entry, but it produced no file markers. It logged only `Running start-up script ("F:/.../u3_final.py")`, indicating the config value was treated as a quoted literal rather than a normal script path. No import was attempted. Evidence: `.../Saved/Logs/VRM4UTest.log`; `result.json` was not created.

The first config form, `StartupScripts=(Path="...")`, produced a Python `SyntaxError` and was not counted as an import attempt.

## Result

| Input | Import result | Assets/bones/morphs/physics/meta |
|---|---|---|
| Aurelia | UNTESTED | none |
| Vaelith | UNTESTED | none |
| Marcus | UNTESTED | none |
| coord42c Blender VRM | UNTESTED | none |

The editor itself and VRM4U loaded, but the Python execution path did not remain alive long enough for the callback to reach 120 ticks. No Unreal/VRM4U compatibility claim is justified. All UnrealEditor processes started by U3 were stopped; no process remained.

## Final blocker

The cheapest next step is a human-launched interactive Unreal Editor session using the fixture project, or a compiled C++ automation/commandlet entry point. Repeating Python `-ExecutePythonScript`/startup-script routes is not warranted by this bounded evidence.
