// Test-only source contracts. These do not claim mounted application or native gesture acceptance.
// CSS length conversion below is an explicit 16px-root contract, not a browser geometry measurement.
import ts from 'typescript';
import * as React from 'react';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {compile} from 'tailwindcss';
interface CssParent {type:string;selector?:string;name?:string;parent?:CssParent}
interface CssDeclaration {prop:string;value:string;parent?:CssParent}
interface CssRule extends CssParent {selector:string;walkDecls(property:string,callback:(decl:CssDeclaration)=>void):void}
interface CssRoot {walkDecls(callback:(decl:CssDeclaration)=>void):void;walkRules(callback:(rule:CssRule)=>void):void}
// Resolve the parser from the already declared CSS plugin, not a hoisted transitive package.
const postcss=createRequire(createRequire(import.meta.url).resolve('@tailwindcss/postcss'))('postcss') as {parse(css:string):CssRoot};
export type Opening=ts.JsxOpeningElement|ts.JsxSelfClosingElement;
export interface UiSource {file:ts.SourceFile;nodes:ts.Node[]}
export function parseUiSource(text:string):UiSource{
 const file=ts.createSourceFile('actual-ui.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),nodes:ts.Node[]=[];
 const visit=(node:ts.Node):void=>{nodes.push(node);ts.forEachChild(node,visit);};visit(file);return {file,nodes};
}
export function uniqueNode<T>(nodes:T[],label:string):T{
 if(nodes.length!==1)throw Error('UI_UNIQUE_'+label+':'+nodes.length);return nodes[0];
}
export function openingNodes(source:UiSource):Opening[]{return source.nodes.filter((node):node is Opening=>ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node));}
export function attrNode(node:Opening,name:string):ts.JsxAttribute|undefined{
 return node.attributes.properties.find((prop):prop is ts.JsxAttribute=>ts.isJsxAttribute(prop)&&prop.name.getText()===name);
}
export function literalAttr(node:Opening,name:string):string|boolean|undefined{
 const attr=attrNode(node,name);if(!attr)return undefined;if(!attr.initializer)return true;
 return ts.isStringLiteral(attr.initializer)?attr.initializer.text:undefined;
}
export function evaluateUi(source:UiSource,node:ts.Node,scope:Record<string,unknown>={}):unknown{
 const compiled=ts.transpileModule('const value=('+node.getText(source.file)+');',{fileName:'actual-expression.tsx',
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React},reportDiagnostics:true});
 if(compiled.diagnostics?.some(value=>value.category===ts.DiagnosticCategory.Error))throw Error('UI_EXPRESSION_SYNTAX');
 const env={React,fetch:():never=>{throw Error('UI_UNEXPECTED_NETWORK');},window:undefined,document:undefined,localStorage:undefined,process:undefined,...scope};
 return new Function(...Object.keys(env),compiled.outputText+'\nreturn value;')(...Object.values(env)) as unknown;
}
export function readUiAttr(source:UiSource,node:Opening,name:string,scope:Record<string,unknown>={}):unknown{
 const attr=attrNode(node,name);if(!attr)throw Error('UI_MISSING_ATTRIBUTE:'+name);
 if(!attr.initializer)return true;if(ts.isStringLiteral(attr.initializer))return attr.initializer.text;
 if(!ts.isJsxExpression(attr.initializer)||!attr.initializer.expression)throw Error('UI_ATTRIBUTE_EXPRESSION:'+name);
 return evaluateUi(source,attr.initializer.expression,scope);
}
export function variableInitializer(source:UiSource,name:string):ts.Expression{
 const declaration=uniqueNode(source.nodes.filter((node):node is ts.VariableDeclaration=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name),name);
 if(!declaration.initializer)throw Error('UI_INITIALIZER:'+name);return declaration.initializer;
}
export function callbackInitializer(source:UiSource,name:string):ts.Expression{
 const call=variableInitializer(source,name);if(!ts.isCallExpression(call)||call.arguments.length<1)throw Error('UI_CALLBACK:'+name);return call.arguments[0];
}
export function parentOpening(node:Opening):Opening{
 let ancestor:ts.Node|undefined=node.parent.parent;
 while(ancestor){if(ts.isJsxElement(ancestor))return ancestor.openingElement;ancestor=ancestor.parent;}
 throw Error('UI_PARENT_ELEMENT');
}
let compilerPromise:ReturnType<typeof compile>|undefined;
async function actualCompiler():ReturnType<typeof compile>{
 if(!compilerPromise){const require=createRequire(import.meta.url);
  compilerPromise=compile(readFileSync(path.resolve('src/app/globals.css'),'utf8'),{base:process.cwd(),
   loadStylesheet:async(id:string,base:string)=>{
    const file=id==='tailwindcss'?require.resolve('tailwindcss/index.css'):id==='tw-animate-css'?path.resolve('node_modules/tw-animate-css/dist/tw-animate.css'):require.resolve(id.startsWith('.')?path.resolve(base,id):id);
    return {path:file,base:path.dirname(file),content:readFileSync(file,'utf8')};
   }});
 }return compilerPromise;
}
export async function baseCssProperty(className:string,property:string):Promise<{value:string;variables:Record<string,string>}>{
 const candidates=className.trim().split(/\s+/),css=postcss.parse((await actualCompiler()).build(candidates));
 const selectors=new Set(candidates.map(value=>'.'+value.replace(/([^a-zA-Z0-9_-])/g,'\\$1'))),variables:Record<string,string>={};let value:string|undefined;
 css.walkDecls(decl=>{if(decl.prop.startsWith('--')&&decl.parent?.type==='rule'&&/:root|:host/.test(decl.parent.selector??''))variables[decl.prop]=decl.value;});
 css.walkRules(rule=>{if(!selectors.has(rule.selector))return;
  rule.walkDecls(property,decl=>{let parent=rule.parent;while(parent){if(parent.type==='atrule'&&parent.name==='media')throw Error('UI_BASE_PROPERTY_HAS_MEDIA:'+property);parent=parent.parent;}value=decl.value;});
 });
 if(value===undefined)throw Error('UI_COMPILED_PROPERTY_MISSING:'+property);return {value,variables};
}
function simpleLengthPx(value:string):number{
 const match=/^([\d.]+)(px|rem)$/.exec(value.trim());if(!match)throw Error('UI_UNSUPPORTED_LENGTH:'+value);
 return Number(match[1])*(match[2]==='rem'?16:1);
}
export async function minimumHeightPx(className:string):Promise<number>{
 const css=await baseCssProperty(className,'min-height');
 const calc=/^calc\(var\((--[a-z-]+)\)\s*\*\s*([\d.]+)\)$/.exec(css.value);
 return calc?simpleLengthPx(css.variables[calc[1]]??'missing')*Number(calc[2]):simpleLengthPx(css.value);
}
