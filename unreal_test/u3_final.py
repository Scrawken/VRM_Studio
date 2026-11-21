import unreal, json, os, traceback, time
RESULT = 'F:/Projects/vrm-forge-studio/_staging/tmp/u3/result.json'
LOG = 'F:/Projects/vrm-forge-studio/_staging/tmp/u3/progress.log'
state={'phase':'script_started','ticks':0,'samples':[],'started_at':time.time()}
def write(phase, **extra):
    state.update({'phase':phase,'updated_at':time.time()}); state.update(extra)
    with open(LOG,'a',encoding='utf-8') as f: f.write(json.dumps(state)+'\n')
    with open(RESULT,'w',encoding='utf-8') as f: json.dump(state,f,indent=2)
write('script_started', execute_script=True)

def tick(dt):
    state['ticks'] += 1
    if state['ticks'] in (1,10,30,60,90,120): write('tick_wait', ticks=state['ticks'])
    if state['ticks'] < 120 or state.get('done'): return
    state['done']=True; write('import_begin', ticks=state['ticks'])
    for name in ['aurelia','vaelith','marcus','coord42c']:
        src='F:/Projects/vrm-forge-studio/_staging/tmp/u3/inputs/'+name+'.vrm'
        rec={'sample':name,'source':src}
        try:
            write('sample_begin', current=name)
            task=unreal.AssetImportTask()
            task.set_editor_properties({'automated':True,'save':True,'destination_path':'/Game/VRM','filename':src,'replace_existing':True})
            unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
            rec['imported_object_paths']=task.get_editor_property('imported_object_paths')
            rec['result']=str(task.get_editor_property('result'))
            rec['assets']=unreal.EditorAssetLibrary.list_assets('/Game/VRM',recursive=True,include_folder=False)
            write('sample_done', current=name, sample_result=rec)
        except Exception:
            rec['error']=traceback.format_exc(); write('sample_error', current=name, sample_result=rec)
        state['samples'].append(rec); write('sample_recorded', current=name)
    write('complete', samples=state['samples'])
    unreal.SystemLibrary.quit_editor()

HANDLE = unreal.register_slate_post_tick_callback(tick)
write('callback_registered', handle_retained=True)
