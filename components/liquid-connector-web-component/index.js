import "./liquid-path.js";
import "./liquid-connector.js";

const { LiquidConnector, LiquidPath } = globalThis;

if (!LiquidConnector || !LiquidPath) {
  throw new Error("Liquid Connector failed to initialize in this browser.");
}

export { LiquidConnector, LiquidPath };
export default LiquidConnector;
