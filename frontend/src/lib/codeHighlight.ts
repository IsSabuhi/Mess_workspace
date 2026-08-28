import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

/** Языки подсветки — как в базе знаний. */
export const codeHighlightLowlight = createLowlight();
codeHighlightLowlight.register("bash", bash);
codeHighlightLowlight.register("javascript", javascript);
codeHighlightLowlight.register("typescript", typescript);
codeHighlightLowlight.register("python", python);
codeHighlightLowlight.register("json", json);
codeHighlightLowlight.register("xml", xml);
codeHighlightLowlight.register("css", css);
codeHighlightLowlight.register("sql", sql);
codeHighlightLowlight.register("plaintext", () => ({
  name: "Plaintext",
  aliases: ["text", "txt"],
  disableAutodetect: true,
  contains: [],
}));

export const CODE_BLOCK_LANGUAGES = [
  { label: "Код", value: "" },
  { label: "Bash", value: "bash" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "JSON", value: "json" },
  { label: "XML/HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "SQL", value: "sql" },
] as const;
