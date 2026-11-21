import unreal, json, traceback, os
for name in ['aurelia','vaelith','marcus','coord42c']:
 src='F:/Projects/vrm-forge-studio/_staging/tmp/u2/inputs/'+name+'.vrm'
 t=unreal.AssetImportTask(); t.set_editor_properties({'automated':True,'save':True,'destination_path':'/Game/VRM','filename':src,'replace_existing':True})
 try:
  unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([t])
  unreal.log('U2_IMPORT_TASK '+json.dumps({'sample':name,'result':t.get_editor_property('result'),'paths':t.get_editor_property('imported_object_paths'),'error':t.get_editor_property('result')}))
 except Exception as e: unreal.log_error('U2_IMPORT_TASK_ERR '+json.dumps({'sample':name,'error':traceback.format_exc()}))
