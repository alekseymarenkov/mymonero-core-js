const loadScriptInBrowser = require('load-script')
const MyMoneroCoreBridgeClass = require('./MyMoneroCoreBridgeClass')
const MyMoneroBridge_utils = require('@mymonero/mymonero-bridge-utils')
//
module.exports = function(options)
{
	options = options || {}

	MyMoneroBridge_utils.update_options_for_fallback_to_asmjs(options)

	const platform_info = MyMoneroBridge_utils.detect_platform();
	const ENVIRONMENT_IS_WEB = platform_info.ENVIRONMENT_IS_WEB;
	const ENVIRONMENT_IS_WORKER = platform_info.ENVIRONMENT_IS_WORKER;
	const ENVIRONMENT_IS_NODE = platform_info.ENVIRONMENT_IS_NODE;
	const ENVIRONMENT_IS_SHELL = platform_info.ENVIRONMENT_IS_SHELL;

	function getDefaultScriptDirectory() {
		let scriptDirectory = '';

		if (ENVIRONMENT_IS_NODE) {
			if (ENVIRONMENT_IS_WORKER) {
				scriptDirectory = require("path").dirname(scriptDirectory) + "/"
			} else {
				scriptDirectory = __dirname + "/"
			}
		} else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
			if (ENVIRONMENT_IS_WORKER) {
				scriptDirectory = self.location.href
			} else if (typeof document !== "undefined" && document.currentScript) {
				scriptDirectory = document.currentScript.src
			}

			if (scriptDirectory.indexOf("blob:") !== 0) {
				scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
			} else {
				scriptDirectory = "";
			}
		}

		return scriptDirectory;
	}

	function loadScript(fileLocation) {
		if (ENVIRONMENT_IS_NODE) {
			let effectiveRequire = require;

			if (typeof __non_webpack_require__ !== 'undefined') {
				effectiveRequire = __non_webpack_require__;
			}

			return Promise.resolve(effectiveRequire(fileLocation));
		} else if (ENVIRONMENT_IS_WEB) {
			if (typeof MyMoneroCoreCpp !== 'undefined') {
				return Promise.resolve(MyMoneroCoreCpp);
			}

			return new Promise(function (resolve, reject) {
				loadScriptInBrowser(fileLocation, function (error) {
					if (error) {
						reject(error);
						return;
					}

					resolve(MyMoneroCoreCpp);
				});
			});
		}

		throw new Error('Not sure how to load: ' + fileLocation);
	}

	function locateFile(filename, scriptDirectory = getDefaultScriptDirectory())
	{
		// if (options["locateFile"]) {
		//		return options["locateFile"](filename, scriptDirectory)
		// }
		var this_scriptDirectory = scriptDirectory
		const lastChar = this_scriptDirectory.charAt(this_scriptDirectory.length - 1)
		if (lastChar == "/" || lastChar == "\\") {
			// ^-- this is not a '\\' on Windows because emscripten actually appends a '/'
			this_scriptDirectory = this_scriptDirectory.substring(0, this_scriptDirectory.length - 1) // remove trailing "/"
		}
		var fullPath = null; // add trailing slash to this
		if (ENVIRONMENT_IS_NODE) {
			const path = require('path')
			const lastPathComponent = path.basename(this_scriptDirectory)
			if (lastPathComponent == "monero_utils") { // typical node or electron-main process
				fullPath = path.format({
					dir: this_scriptDirectory,
					base: filename
				})
			} else {
				console.warn(`MyMoneroCoreBridge/locateFile() on node.js didn't find "monero_utils" (or possibly MyMoneroCoreBridge.js) itself in the expected location in the following path. The function may need to be expanded but it might in normal situations be likely to be another bug. ${pathTo_cryptonoteUtilsDir}`)
			}
		} else if (ENVIRONMENT_IS_WEB) {
			var pathTo_cryptonoteUtilsDir;
			if (typeof __dirname !== undefined && __dirname !== "/") { // looks like node running in browser.. (but not going to assume it's electron-renderer since that should be taken care of by monero_utils.js itself)
				// but just in case it is... here's an attempt to support it
				// have to check != "/" b/c webpack (I think) replaces __dirname
				pathTo_cryptonoteUtilsDir = "file://" + __dirname + "/" // prepending "file://" because it's going to try to stream it
			} else { // actual web browser
				pathTo_cryptonoteUtilsDir = this_scriptDirectory + '/'
				if (pathTo_cryptonoteUtilsDir.indexOf('/mymonero_core_js/monero_utils/') === -1) {
					pathTo_cryptonoteUtilsDir = pathTo_cryptonoteUtilsDir + 'mymonero_core_js/monero_utils/' // this works for the MyMonero browser build, and is quite general, at least
				}
			}
			fullPath = pathTo_cryptonoteUtilsDir + filename
		}
		if (fullPath == null) {
			throw "Unable to derive fullPath. Please pass locateFile() to bridge obj init."
		}
		//
		return fullPath
	}

	return Promise.resolve({ locateFile })
		.then(function (Module_template) {
			return require(`./MyMoneroCoreCpp_WASM`)(Module_template);
		})
		.then(function(thisModule) {
			return new MyMoneroCoreBridgeClass(thisModule);
		})
		.catch(function(error) {
			console.error("Error loading MyMoneroCoreCpp_WASM:", error);
			return Promise.resolve({ locateFile })
				.then(function (Module_template) {
					return loadScript(locateFile('MyMoneroCoreCpp_ASMJS.js'))
						.then(function (MyMoneroCoreCpp_ASMJS) {
							return MyMoneroCoreCpp_ASMJS(Module_template);
						});
				})
				.then(function(thisModule) {
					return new MyMoneroCoreBridgeClass(thisModule);
				})
				.catch(function(error2) {
					console.error("Error loading MyMoneroCoreCpp_ASMJS:", error2);
					error2.relatedError = error2;
					throw error2;
				});
		});
};
