import { registerHooks } from "node:module";
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".module.css"))
      return {
        format: "module",
        source: "export default new Proxy({}, {get:(_,key)=>String(key)})",
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
