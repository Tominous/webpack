/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const RuntimeGlobals = require("../RuntimeGlobals");
const RuntimeModule = require("../RuntimeModule");
const Template = require("../Template");
const chunkHasJs = require("../javascript/JavascriptModulesPlugin").chunkHasJs;
const compileBooleanMatcher = require("../util/compileBooleanMatcher");

class ReadFileChunkLoadingRuntimeModule extends RuntimeModule {
	constructor(runtimeRequirements) {
		super("readFile chunk loading", 10);
		this.runtimeRequirements = runtimeRequirements;
	}

	/**
	 * @returns {string} runtime code
	 */
	generate() {
		const { chunk } = this;
		const { chunkGraph } = this.compilation;
		const fn = RuntimeGlobals.ensureChunkHandlers;
		const withLoading = this.runtimeRequirements.has(
			RuntimeGlobals.ensureChunkHandlers
		);
		const withHmr = this.runtimeRequirements.has(
			RuntimeGlobals.hmrDownloadUpdateHandlers
		);
		const withHmrManifest = this.runtimeRequirements.has(
			RuntimeGlobals.hmrDownloadManifest
		);
		const hasJsMatcher = compileBooleanMatcher(
			chunkGraph.getChunkConditionMap(chunk, chunkHasJs)
		);
		return Template.asString([
			"// object to store loaded chunks",
			'// "0" means "already loaded", Promise means loading',
			"var installedChunks = {",
			Template.indent(
				chunk.ids.map(id => `${JSON.stringify(id)}: 0`).join(",\n")
			),
			"};",
			"",
			withLoading
				? Template.asString([
						"// ReadFile + VM.run chunk loading for javascript",
						`${fn}.readFileVm = function(chunkId, promises) {`,
						hasJsMatcher !== false
							? Template.indent([
									"",
									"var installedChunkData = installedChunks[chunkId];",
									'if(installedChunkData !== 0) { // 0 means "already installed".',
									Template.indent([
										'// array of [resolve, reject, promise] means "currently loading"',
										"if(installedChunkData) {",
										Template.indent(["promises.push(installedChunkData[2]);"]),
										"} else {",
										Template.indent([
											hasJsMatcher === true
												? "if(true) { // all chunks have JS"
												: `if(${hasJsMatcher("chunkId")}) {`,
											Template.indent([
												"// load the chunk and return promise to it",
												"var promise = new Promise(function(resolve, reject) {",
												Template.indent([
													"installedChunkData = installedChunks[chunkId] = [resolve, reject];",
													`var filename = require('path').join(__dirname, ${RuntimeGlobals.getChunkScriptFilename}(chunkId));`,
													"require('fs').readFile(filename, 'utf-8', function(err, content) {",
													Template.indent([
														"if(err) return reject(err);",
														"var chunk = {};",
														"require('vm').runInThisContext('(function(exports, require, __dirname, __filename) {' + content + '\\n})', filename)" +
															"(chunk, require, require('path').dirname(filename), filename);",
														"var moreModules = chunk.modules, chunkIds = chunk.ids, runtime = chunk.runtime;",
														"for(var moduleId in moreModules) {",
														Template.indent([
															`if(${RuntimeGlobals.hasOwnProperty}(moreModules, moduleId)) {`,
															Template.indent([
																`${RuntimeGlobals.moduleFactories}[moduleId] = moreModules[moduleId];`
															]),
															"}"
														]),
														"}",
														`if(runtime) runtime(__webpack_require__);`,
														"var callbacks = [];",
														"for(var i = 0; i < chunkIds.length; i++) {",
														Template.indent([
															"if(installedChunks[chunkIds[i]])",
															Template.indent([
																"callbacks = callbacks.concat(installedChunks[chunkIds[i]][0]);"
															]),
															"installedChunks[chunkIds[i]] = 0;"
														]),
														"}",
														"for(i = 0; i < callbacks.length; i++)",
														Template.indent("callbacks[i]();")
													]),
													"});"
												]),
												"});",
												"promises.push(installedChunkData[2] = promise);"
											]),
											"} else installedChunks[chunkId] = 0;"
										]),
										"}"
									]),
									"}"
							  ])
							: Template.indent(["installedChunks[chunkId] = 0;"]),
						"};"
				  ])
				: "// no chunk loading",
			"",
			withHmr
				? Template.asString([
						"function loadUpdateChunk(chunkId, updatedModulesList) {",
						Template.indent([
							"return new Promise(function(resolve, reject) {",
							Template.indent([
								`var filename = require('path').join(__dirname, ${RuntimeGlobals.getChunkUpdateScriptFilename}(chunkId));`,
								"require('fs').readFile(filename, 'utf-8', function(err, content) {",
								Template.indent([
									"if(err) return reject(err);",
									"var update = {};",
									"require('vm').runInThisContext('(function(exports, require, __dirname, __filename) {' + content + '\\n})', filename)" +
										"(update, require, require('path').dirname(filename), filename);",
									"var updatedModules = update.modules;",
									"var runtime = update.runtime;",
									"for(var moduleId in updatedModules) {",
									Template.indent([
										`if(${RuntimeGlobals.hasOwnProperty}(updatedModules, moduleId)) {`,
										Template.indent([
											`currentUpdate[moduleId] = updatedModules[moduleId];`,
											"if(updatedModulesList) updatedModulesList.push(moduleId);"
										]),
										"}"
									]),
									"}",
									"if(runtime) currentUpdateRuntime.push(runtime);",
									"resolve();"
								]),
								"});"
							]),
							"});"
						]),
						"}",
						"",
						Template.getFunctionContent(
							require("../hmr/JavascriptHotModuleReplacement.runtime.js")
						)
							.replace(/\$key\$/g, "readFileVm")
							.replace(/\$installedChunks\$/g, "installedChunks")
							.replace(/\$loadUpdateChunk\$/g, "loadUpdateChunk")
							.replace(/\$moduleCache\$/g, RuntimeGlobals.moduleCache)
							.replace(/\$moduleFactories\$/g, RuntimeGlobals.moduleFactories)
							.replace(
								/\$ensureChunkHandlers\$/g,
								RuntimeGlobals.ensureChunkHandlers
							)
							.replace(/\$hasOwnProperty\$/g, RuntimeGlobals.hasOwnProperty)
							.replace(/\$hmrModuleData\$/g, RuntimeGlobals.hmrModuleData)
							.replace(
								/\$hmrDownloadUpdateHandlers\$/g,
								RuntimeGlobals.hmrDownloadUpdateHandlers
							)
							.replace(
								/\$hmrInvalidateModuleHandlers\$/g,
								RuntimeGlobals.hmrInvalidateModuleHandlers
							)
				  ])
				: "// no HMR",
			"",
			withHmrManifest
				? Template.asString([
						`${RuntimeGlobals.hmrDownloadManifest} = function() {`,
						Template.indent([
							"return new Promise(function(resolve, reject) {",
							Template.indent([
								`var filename = require('path').join(__dirname, ${RuntimeGlobals.getUpdateManifestFilename}());`,
								"require('fs').readFile(filename, 'utf-8', function(err, content) {",
								Template.indent([
									"if(err) {",
									Template.indent([
										'if(err.code === "ENOENT") return resolve();',
										"return reject(err);"
									]),
									"}",
									"try { resolve(JSON.parse(content)); }",
									"catch(e) { reject(e); }"
								]),
								"});"
							]),
							"});"
						]),
						"}"
				  ])
				: "// no HMR manifest"
		]);
	}
}

module.exports = ReadFileChunkLoadingRuntimeModule;
