// The voice pipelines a licence can run. chakra-ivr-core reads them from the
// signed licence check (`pipelines`, first = default; `agent_pipelines` pins
// named agents), so what is set here is what the client's agents run.

export const PIPELINES = [
  { id: "chakra", label: "Chakra Voice", detail: "Chakra STT → managed LLM → Chakra TTS, on our GPU fleet" },
  { id: "gemini_live", label: "Gemini Live", detail: "Google's realtime model, with the client's own Google key" },
] as const;

export type PipelineId = (typeof PIPELINES)[number]["id"];

const IDS = new Set<string>(PIPELINES.map((p) => p.id));

export function isPipeline(value: unknown): value is PipelineId {
  return typeof value === "string" && IDS.has(value);
}

export function pipelineLabel(id: string | null | undefined): string {
  return PIPELINES.find((p) => p.id === id)?.label ?? "Not assigned";
}

/** "agent = pipeline" lines → a clean map; unknown pipelines and blank lines dropped. */
export function parseAgentPins(text: string): Record<string, PipelineId> {
  const pins: Record<string, PipelineId> = {};
  for (const line of text.split(/\r?\n/)) {
    const [agent, pipeline] = line.split("=").map((s) => s.trim());
    if (agent && isPipeline(pipeline)) pins[agent.slice(0, 120)] = pipeline;
  }
  return pins;
}

export function formatAgentPins(pins: Record<string, string> | null | undefined): string {
  return Object.entries(pins ?? {})
    .map(([agent, pipeline]) => `${agent} = ${pipeline}`)
    .join("\n");
}
