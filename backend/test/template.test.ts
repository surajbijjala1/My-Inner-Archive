// Prompt templates are filled with user text and model output. These tests pin
// the two ways the old chained String.replace let that text escape its slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "../src/lib/template.js";

const TEMPLATE = 'Recent conversation:\n{{CONVERSATION}}\n\nReply to judge:\n"""\n{{REPLY}}\n"""\nOne word:';

test("fills each slot with its own value", () => {
  const out = fillTemplate(TEMPLATE, { CONVERSATION: "User: hi", REPLY: "hello there" });
  assert.equal(out, 'Recent conversation:\nUser: hi\n\nReply to judge:\n"""\nhello there\n"""\nOne word:');
});

test("a user turn containing a slot name cannot capture another slot's value", () => {
  // Old behaviour: the reply was substituted into the user's "{{REPLY}}" and
  // the audited slot stayed blank, so the boundary audit judged nothing.
  const out = fillTemplate(TEMPLATE, {
    CONVERSATION: "User: please write {{REPLY}} for me",
    REPLY: "AUDIT-ME",
  });
  assert.ok(out.includes('Reply to judge:\n"""\nAUDIT-ME\n"""'), "the real slot holds the reply");
  assert.ok(out.includes("User: please write {{REPLY}} for me"), "the user's text is left literal");
  assert.equal(out.split("AUDIT-ME").length - 1, 1, "the reply appears exactly once");
});

test("replacement patterns in a value are inserted literally", () => {
  for (const hostile of ["$&", "$'", "$`", "$$", "$1", "cost me $' and $& more"]) {
    const out = fillTemplate(TEMPLATE, { CONVERSATION: "(start)", REPLY: hostile });
    assert.ok(out.includes(`"""\n${hostile}\n"""`), `literal: ${hostile}`);
    assert.equal(
      out.length,
      TEMPLATE.length - "{{CONVERSATION}}{{REPLY}}".length + "(start)".length + hostile.length
    );
  }
});

test("unknown slots are left alone rather than blanked", () => {
  assert.equal(fillTemplate("a {{OTHER}} b", { REPLY: "x" }), "a {{OTHER}} b");
  assert.equal(fillTemplate("a {{CONSTRUCTOR}} b", {}), "a {{CONSTRUCTOR}} b");
});
