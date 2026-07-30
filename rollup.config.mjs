 import resolve from "@rollup/plugin-node-resolve";
 import terser from "@rollup/plugin-terser";
 
 const production = !process.env.ROLLUP_WATCH;
 
 const plugins = [resolve(), production && terser()].filter(Boolean);
 
 export default [
   // service worker — ES module
   {
     input: "background.js",
     output: {
       file: "dist/background.js",
       format: "es",
     },
     plugins,
   },
   // side panel app — ES module
   {
     input: "src/app.js",
     output: {
       file: "dist/panel.js",
       format: "es",
     },
     plugins,
   },
   // content script — IIFE (injected via manifest, not a module)
   {
     input: "content.js",
     output: {
       file: "dist/content.js",
       format: "iife",
       name: "tutuContent",
     },
     plugins,
   },
 ];
