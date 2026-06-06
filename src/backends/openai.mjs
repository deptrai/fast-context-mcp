/**
 * OpenAI-compatible backend — wraps the OpenAI/deep search protocol.
 */
import { searchOpenAI } from "../openai-backend.mjs";

export class OpenAIBackend {
  name = "openai";
  get model() { return process.env.FC_DEEP_MODEL || "deep-search"; }

  async search(opts) {
    return searchOpenAI(opts);
  }
}
