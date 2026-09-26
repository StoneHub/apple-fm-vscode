// Verify refactoring never overwrites a newer editor version and applies only a captured range.
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const events = {};
const noop = () => ({dispose(){}});
const listen = name => handler => {events[name]=handler;return noop();};
class Range {constructor(start,end){this.start=start;this.end=end;}}
const doc = {uri:{scheme:'file',fsPath:'/tmp/refactor-test.js',toString:()=> 'file:///tmp/refactor-test.js'},fileName:'/tmp/refactor-test.js',version:1,isClosed:false,languageId:'javascript',getText:()=> 'const x = 1;'};
const editor = {document:doc,selection:{start:{line:0,character:0},end:{line:0,character:12},isEmpty:false},edit:async(build,options)=>{let edit;build({replace:(range,text)=>{edit={range,text};}});assert.equal(edit.text,'const x = 2;');assert.deepEqual(options,{undoStopBefore:true,undoStopAfter:true});doc.version++;editor.edits++;return true;},edits:0};
let onShow;
const commands=[];
const vscode = {Range,UIKind:{Web:2},env:{uiKind:1},Uri:{from:({scheme,path})=>({toString:()=>scheme+':'+path})},
workspace:{registerTextDocumentContentProvider:noop,onDidChangeTextDocument:listen('change'),onDidCloseTextDocument:listen('close')},
window:{activeTextEditor:editor,onDidChangeActiveTextEditor:listen('active'),onDidChangeTextEditorSelection:listen('selection'),showTextDocument:async()=>{onShow?.();return editor;},showWarningMessage:()=>{}},
commands:{executeCommand:async(...args)=>{commands.push(args);}}};
class Runner {cancel(){} async dispose(){} async run(){return {text:'const x = 2;',diagnostics:{argv:[],stdin:'selected code',backend:'CLI',model:'system',inputChars:13}};}}
Module._load=function(name,parent,isMain){if(name==='vscode')return vscode;if(name==='./refactorRunner')return {RefactorRunner:Runner};return originalLoad.call(this,name,parent,isMain);};
const {RefactorController}=require('../dist/refactor');
Object.defineProperty(process,'platform',{value:'darwin'}); // Refactoring is Mac-only; the stubbed editor stands in for a local Mac window.
Module._load=originalLoad;
(async()=>{
 const controller=new RefactorController(()=>{},async()=>{});
 await controller.capture();
 await controller.generate('Change x to 2.',3);
 assert.equal(controller.snapshot().candidates.length,3);
 assert.equal(controller.snapshot().candidates[1].duplicate,true);
 await controller.compare();assert.equal(commands.at(-1)[0],'vscode.diff');
 assert.equal(editor.edits,0,'generation and comparison must not edit');
 doc.version++;
 await assert.rejects(()=>controller.apply(),/source changed/i);
 assert.equal(editor.edits,0,'stale result must not edit');
 await controller.capture();await controller.generate('Change x to 2.',1);
 onShow=()=>doc.version++;
 await assert.rejects(()=>controller.apply(),/source changed/i);
 assert.equal(editor.edits,0,'source change during focus must not edit');
 onShow=undefined;
 await controller.capture();await controller.generate('Change x to 2.',3);
 await controller.generate('Change x to 2.',3);await controller.generate('Change x to 2.',3);
 assert.equal(controller.snapshot().candidates.length,9);
 await assert.rejects(()=>controller.generate('Change x to 2.',1),/Nine/);
 await controller.apply();assert.equal(editor.edits,1);assert.equal(controller.snapshot().applied,true);
 await controller.apply();assert.equal(editor.edits,1,'must not apply twice');
 controller.dispose();
 console.log('refactor regressions: PASS (alternatives, diff, stale source, focus race, apply once)');
})().catch(error=>{console.error(error);process.exitCode=1;});
