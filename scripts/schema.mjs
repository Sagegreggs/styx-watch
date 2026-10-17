// Reconstructed from the PayBox starter 1.0.2 description (verbatim copy was unavailable).
import Ajv2020 from "ajv/dist/2020.js";
import { ConformanceError } from "./report.mjs";

const ajv = new Ajv2020({ strict: false, validateFormats: false, logger: false });

export function compileSchema(schema) {
  if (schema && schema.$async) throw new ConformanceError("Async schemas are not supported", "schema_invalid");
  try {
    return ajv.compile(schema);
  } catch {
    throw new ConformanceError("Tool schema is not a valid self-contained JSON Schema 2020-12", "schema_invalid");
  }
}

export function validateSample(tool, argumentsValue, result) {
  const input = compileSchema(tool.inputSchema);
  if (!input(argumentsValue)) throw new ConformanceError("Sample arguments do not match the input schema", "arguments_invalid");
  if (tool.outputSchema && result !== undefined) {
    const output = compileSchema(tool.outputSchema);
    if (!result || !("structuredContent" in result) || !output(result.structuredContent)) {
      throw new ConformanceError("Structured output does not match the output schema", "result_invalid");
    }
  }
}
