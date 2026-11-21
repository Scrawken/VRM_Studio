import unreal, json, traceback
for name in ['aurelia', 'vaelith', 'marcus']:
    source = 'F:/Projects/vrm-forge-studio/_staging/tmp/u1/inputs/' + name + '.vrm'
    options = unreal.ImportOptionData()
    options.set_editor_properties({'skip_physics': False, 'skip_morph_target': False, 'remove_degenerate_triangles': True})
    try:
        asset = unreal.VrmImporterBPFunctionLibrary.import_vrm_file_with_options(source, '/Game/Characters/' + name, options)
        unreal.log('VRM4U_RESULT ' + json.dumps({'sample': name, 'returned': asset is not None}))
    except Exception:
        unreal.log_error('VRM4U_RESULT ' + json.dumps({'sample': name, 'error': traceback.format_exc()}))
