"""Deterministic Xcode project generation using Python's standard library."""
from pathlib import Path
import hashlib, json, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
objects = {}
def uid(name): return hashlib.sha1(name.encode()).hexdigest()[:24].upper()
def obj(seed, isa, **fields):
    key = uid(seed); objects[key] = {'isa': isa, **fields}; return key
def ref(name): return uid(name)
def configurations(name, settings):
    refs=[]
    for mode in ('Debug','Release'):
        values=dict(settings)
        values.update({'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if mode == 'Debug' else '-O', 'DEBUG_INFORMATION_FORMAT': 'dwarf' if mode == 'Debug' else 'dwarf-with-dsym'})
        if mode == 'Debug': values['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG $(inherited)'
        refs.append(obj(name+mode,'XCBuildConfiguration',name=mode,buildSettings=values))
    return obj(name+'configs','XCConfigurationList',buildConfigurations=refs,defaultConfigurationIsVisible=0,defaultConfigurationName='Release')

file_refs=[]
for path in sorted((ROOT/'AppleApp').glob('*.swift')):
    file_refs.append(obj('file:'+path.name,'PBXFileReference',lastKnownFileType='sourcecode.swift',path=path.name,sourceTree='<group>'))
app_group = obj('appgroup','PBXGroup',children=file_refs,path='AppleApp',sourceTree='<group>')
ui_file = obj('uifile','PBXFileReference',lastKnownFileType='sourcecode.swift',path='PlannerUITests.swift',sourceTree='<group>')
ui_group = obj('uigroup','PBXGroup',children=[ui_file],path='AppleUITests',sourceTree='<group>')
package = obj('package','XCLocalSwiftPackageReference',relativePath='.')
targets=[]; products=[]
for name, sdk, bundle in [('LivePlanner','iphoneos','com.olegkotikov.liveplanner.swift.dev'),('LivePlannerMac','macosx','com.olegkotikov.liveplanner.swift.mac.dev')]:
    sources = [obj(name+':build:'+r,'PBXBuildFile',fileRef=r) for r in file_refs]
    source_phase = obj(name+'sources','PBXSourcesBuildPhase',buildActionMask=2147483647,files=sources,runOnlyForDeploymentPostprocessing=0)
    package_products=[]; framework_files=[]
    for product in ('PlannerCore','PlannerStorage'):
        p = obj(name+product,'XCSwiftPackageProductDependency',package=package,productName=product)
        package_products.append(p); framework_files.append(obj(name+product+'build','PBXBuildFile',productRef=p))
    frameworks = obj(name+'frameworks','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=framework_files,runOnlyForDeploymentPostprocessing=0)
    resources = obj(name+'resources','PBXResourcesBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0)
    product = obj(name+'product','PBXFileReference',explicitFileType='wrapper.application',includeInIndex=0,path=name+'.app',sourceTree='BUILT_PRODUCTS_DIR'); products.append(product)
    settings={'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':bundle,'SWIFT_VERSION':'6.0','GENERATE_INFOPLIST_FILE':'YES',
              'INFOPLIST_KEY_CFBundleDisplayName':'Live Planner Swift','MARKETING_VERSION':'0.1.0','CURRENT_PROJECT_VERSION':'1',
              'SDKROOT':sdk,'CODE_SIGN_STYLE':'Automatic','ENABLE_HARDENED_RUNTIME':'YES'}
    if sdk == 'iphoneos':
        settings.update({'IPHONEOS_DEPLOYMENT_TARGET':'17.0','TARGETED_DEVICE_FAMILY':'1,2','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator',
                         'INFOPLIST_KEY_UILaunchScreen_Generation':'YES','INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','SUPPORTS_MACCATALYST':'NO'})
    else:
        settings.update({'MACOSX_DEPLOYMENT_TARGET':'14.0','SUPPORTED_PLATFORMS':'macosx','ENABLE_APP_SANDBOX':'YES',
                         'ENABLE_USER_SELECTED_FILES':'readwrite','CODE_SIGN_ENTITLEMENTS':'AppleApp/LivePlannerMac.entitlements'})
    config = configurations(name, settings)
    target = obj(name,'PBXNativeTarget',buildConfigurationList=config,buildPhases=[source_phase,frameworks,resources],buildRules=[],dependencies=[],
                 name=name,packageProductDependencies=package_products,productName=name,productReference=product,productType='com.apple.product-type.application')
    targets.append(target)

test_name='LivePlannerUITests'
test_product=obj('uitestproduct','PBXFileReference',explicitFileType='wrapper.cfbundle',includeInIndex=0,path=test_name+'.xctest',sourceTree='BUILT_PRODUCTS_DIR'); products.append(test_product)
test_source=obj('uitestsource','PBXSourcesBuildPhase',buildActionMask=2147483647,files=[obj('uitestbuildfile','PBXBuildFile',fileRef=ui_file)],runOnlyForDeploymentPostprocessing=0)
test_framework=obj('uitestframework','PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0)
proxy=obj('uitestproxy','PBXContainerItemProxy',containerPortal=ref('project'),proxyType=1,remoteGlobalIDString=ref('LivePlanner'),remoteInfo='LivePlanner')
dependency=obj('uitestdependency','PBXTargetDependency',target=ref('LivePlanner'),targetProxy=proxy)
test_configs=configurations(test_name,{'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'com.olegkotikov.liveplanner.swift.uitests','SWIFT_VERSION':'6.0',
    'GENERATE_INFOPLIST_FILE':'YES','SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'17.0','TARGETED_DEVICE_FAMILY':'1,2','TEST_TARGET_NAME':'LivePlanner','CODE_SIGN_STYLE':'Automatic'})
targets.append(obj(test_name,'PBXNativeTarget',buildConfigurationList=test_configs,buildPhases=[test_source,test_framework],buildRules=[],dependencies=[dependency],
    name=test_name,productName=test_name,productReference=test_product,productType='com.apple.product-type.bundle.ui-testing'))
products_group=obj('products','PBXGroup',children=products,name='Products',sourceTree='<group>')
main=obj('main','PBXGroup',children=[app_group,ui_group,products_group],sourceTree='<group>')
project_config=configurations('project',{'CLANG_ENABLE_MODULES':'YES','SWIFT_VERSION':'6.0','SWIFT_STRICT_CONCURRENCY':'complete'})
project=obj('project','PBXProject',attributes={'LastUpgradeCheck':'1600','BuildIndependentTargetsInParallel':'YES','TargetAttributes':{ref(test_name):{'TestTargetID':ref('LivePlanner')}}},
    buildConfigurationList=project_config,compatibilityVersion='Xcode 14.0',developmentRegion='en',hasScannedForEncodings=0,knownRegions=['en','Base'],
    mainGroup=main,productRefGroup=products_group,projectDirPath='',projectRoot='',packageReferences=[package],targets=targets)

def encode(value, level=0):
    if isinstance(value,dict): return '{\n'+''.join('\t'*(level+1)+json.dumps(k)+' = '+encode(v,level+1)+';\n' for k,v in value.items())+'\t'*level+'}'
    if isinstance(value,list): return '('+', '.join(encode(v,level) for v in value)+')'
    if isinstance(value,int): return str(value)
    return json.dumps(value)
folder=ROOT/'LivePlanner.xcodeproj'; folder.mkdir(exist_ok=True)
(folder/'project.pbxproj').write_text('// !$*UTF8*$!\n'+encode({'archiveVersion':1,'classes':{},'objectVersion':56,'objects':objects,'rootObject':project})+'\n')

def buildable(parent,name):
    return ET.SubElement(parent,'BuildableReference',BuildableIdentifier='primary',BlueprintIdentifier=ref(name),BuildableName=name+('.xctest' if name==test_name else '.app'),BlueprintName=name,ReferencedContainer='container:LivePlanner.xcodeproj')
shared=folder/'xcshareddata'/'xcschemes'; shared.mkdir(parents=True,exist_ok=True)
for name in ('LivePlanner','LivePlannerMac'):
    scheme=ET.Element('Scheme',LastUpgradeVersion='1600',version='1.3')
    action=ET.SubElement(scheme,'BuildAction',parallelizeBuildables='YES',buildImplicitDependencies='YES')
    entries=ET.SubElement(action,'BuildActionEntries')
    entry=ET.SubElement(entries,'BuildActionEntry',buildForTesting='YES',buildForRunning='YES',buildForProfiling='YES',buildForArchiving='YES',buildForAnalyzing='YES'); buildable(entry,name)
    test=ET.SubElement(scheme,'TestAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',shouldUseLaunchSchemeArgsEnv='YES')
    if name=='LivePlanner':
        testables=ET.SubElement(test,'Testables'); buildable(ET.SubElement(testables,'TestableReference',skipped='NO'),test_name)
    launch=ET.SubElement(scheme,'LaunchAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',launchStyle='0',useCustomWorkingDirectory='NO',ignoresPersistentStateOnLaunch='NO',debugDocumentVersioning='YES',debugServiceExtension='internal',allowLocationSimulation='YES')
    buildable(ET.SubElement(launch,'BuildableProductRunnable',runnableDebuggingMode='0'),name)
    profile=ET.SubElement(scheme,'ProfileAction',buildConfiguration='Release',shouldUseLaunchSchemeArgsEnv='YES',savedToolIdentifier='',useCustomWorkingDirectory='NO',debugDocumentVersioning='YES'); buildable(ET.SubElement(profile,'BuildableProductRunnable',runnableDebuggingMode='0'),name)
    ET.SubElement(scheme,'AnalyzeAction',buildConfiguration='Debug'); ET.SubElement(scheme,'ArchiveAction',buildConfiguration='Release',revealArchiveInOrganizer='YES')
    ET.indent(scheme)
    ET.ElementTree(scheme).write(shared/(name+'.xcscheme'),encoding='utf-8',xml_declaration=True)
print(f'Generated Xcode project: {len(objects)} objects, 2 apps + UI test target')
