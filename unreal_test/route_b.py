import unreal, json, traceback
state={'done':False,'ticks':0}
def tick(dt):
    state['ticks']+=1
    if state['done'] or state['ticks']<20: return
    state['done']=True
    try:
        src='F:/Projects/vrm-forge-studio/_staging/tmp/u2/inputs/aurelia.vrm'
        opt=unreal.ImportOptionData(); opt.set_editor_properties({'skip_physics':False,'skip_morph_target':False,'remove_degenerate_triangles':True})
        asset=unreal.VrmImporterBPFunctionLibrary.import_vrm_file_with_options(src,'/Game/VRM/aurelia',opt)
        paths=unreal.EditorAssetLibrary.list_assets('/Game/VRM',recursive=True,include_folder=False)
        unreal.log('U2_TICK_RESULT '+json.dumps({'returned':asset is not None,'assets':paths}))
    except Exception: unreal.log_error('U2_TICK_ERROR '+traceback.format_exc())
    unreal.SystemLibrary.quit_editor()
unreal.register_slate_post_tick_callback(tick)
unreal.log('U2_TICK_REGISTERED')
