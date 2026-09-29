"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "instrumentation";
exports.ids = ["instrumentation"];
exports.modules = {

/***/ "(instrument)/./instrumentation.ts":
/*!****************************!*\
  !*** ./instrumentation.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   register: () => (/* binding */ register)\n/* harmony export */ });\nasync function register() {\n    if (true) {\n        const { registerOtel } = await Promise.all(/*! import() */[__webpack_require__.e(\"vendor-chunks/@vercel+otel@2.1.3_@opentelemetry+api-logs@0.222.0_@opentelemetry+api@1.9.1_@openteleme_1b5449313106ac38a952a6b3c2c1dd82\"), __webpack_require__.e(\"vendor-chunks/@opentelemetry+api@1.9.1\"), __webpack_require__.e(\"vendor-chunks/@opentelemetry+api-logs@0.222.0\"), __webpack_require__.e(\"_instrument_lib_otel_ts\")]).then(__webpack_require__.bind(__webpack_require__, /*! ./lib/otel */ \"(instrument)/./lib/otel.ts\"));\n        registerOtel();\n    }\n    if (false) {}\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGluc3RydW1lbnQpLy4vaW5zdHJ1bWVudGF0aW9uLnRzIiwibWFwcGluZ3MiOiI7Ozs7QUFBTyxlQUFlQTtJQUNwQixJQUFJQyxJQUFxQyxFQUFFO1FBQ3pDLE1BQU0sRUFBRUcsWUFBWSxFQUFFLEdBQUcsTUFBTSw0ZEFBb0I7UUFDbkRBO0lBQ0Y7SUFDQSxJQUFJSCxLQUFtQyxFQUFFLEVBR3hDO0FBQ0giLCJzb3VyY2VzIjpbIi9Vc2Vycy9kZXZhL0RvY3VtZW50cy9Qcm9qZWN0cy9nb2FsY29hY2h2Mi9hcHBzL3dlYi9pbnN0cnVtZW50YXRpb24udHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZ2lzdGVyKCkge1xuICBpZiAocHJvY2Vzcy5lbnYuTkVYVF9SVU5USU1FID09PSAnbm9kZWpzJykge1xuICAgIGNvbnN0IHsgcmVnaXN0ZXJPdGVsIH0gPSBhd2FpdCBpbXBvcnQoJy4vbGliL290ZWwnKTtcbiAgICByZWdpc3Rlck90ZWwoKTtcbiAgfVxuICBpZiAocHJvY2Vzcy5lbnYuTkVYVF9SVU5USU1FID09PSAnZWRnZScpIHtcbiAgICBjb25zdCB7IHJlZ2lzdGVyT3RlbCB9ID0gYXdhaXQgaW1wb3J0KCcuL2xpYi9vdGVsJyk7XG4gICAgcmVnaXN0ZXJPdGVsKCk7XG4gIH1cbn1cbiJdLCJuYW1lcyI6WyJyZWdpc3RlciIsInByb2Nlc3MiLCJlbnYiLCJORVhUX1JVTlRJTUUiLCJyZWdpc3Rlck90ZWwiXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(instrument)/./instrumentation.ts\n");

/***/ }),

/***/ "module":
/*!*************************!*\
  !*** external "module" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("module");

/***/ }),

/***/ "path":
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("path");

/***/ }),

/***/ "url":
/*!**********************!*\
  !*** external "url" ***!
  \**********************/
/***/ ((module) => {

module.exports = require("url");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("./webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("(instrument)/./instrumentation.ts"));
module.exports = __webpack_exports__;

})();