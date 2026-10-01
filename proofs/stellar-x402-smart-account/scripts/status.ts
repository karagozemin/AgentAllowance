import { readJson, writeJson } from "./lib/artifacts.js";
import { readState } from "./lib/state.js";

const deployment = await readJson<any>("deployment.json");
const state = readState(deployment);
await writeJson(deployment.runDirectory, "state-current.json", state);
console.log(JSON.stringify(state, null, 2));

