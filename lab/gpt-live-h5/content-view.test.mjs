import test from "node:test";
import assert from "node:assert/strict";
import { contentItems } from "./content-view.mjs";
import { createTranscriptPresentation } from "./transcript-presentation.mjs";

test('short backend media caption stays with its asset in one deliverable', () => {
  for (const [url, kind] of [['https://cdn.test/a.webp','image'], ['https://cdn.test/a.mp4','video']]) {
    const items = contentItems({key:'media',role:'assistant',complete:true,document:true,text:`童趣赛车画面。\n[赛车](${url})`});
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "report");
    assert.deepEqual(items[0].media.map(item => item.kind), [kind]);
    assert.equal(items[0].media[0].url,url);
  }
});

test("actual backend result stays exact, becomes a report, and does not duplicate the speech turn", () => {
  const view = createTranscriptPresentation(),
    text = "# 择校报告\n\n结论：先访校。\n\n|学校|时间|\n|---|---|\n|甲|2028|";
  view.consume({
    type: "turn.done",
    turn: {
      role: "assistant",
      id: "spoken",
      transcript: "结论是先访校，完整方案在屏幕上。",
    },
  });
  const snapshot = view.consume({
    type: "backend.result",
    callId: "task-1",
    text,
  });
  const item = snapshot.history.find((row) => row.document);
  assert.equal(item.text, text);
  assert.equal(contentItems(item)[0].text, text);
  assert.equal(contentItems(item)[0].title, "择校报告");
  assert.equal(snapshot.history.length, 2);
  assert.equal(contentItems(snapshot.history[0]).length, 0);
  assert.equal(
    view.consume({ type: "backend.result", callId: "task-1", text }).history
      .length,
    2,
  );
});
test("streaming speech is never repeatedly expanded into a document", () => {
  assert.deepEqual(
    contentItems({
      key: "s",
      role: "assistant",
      complete: false,
      text: "# 报告\n" + "长文".repeat(1000),
    }),
    [],
  );
});
test("long completed reply has a card, short ordinary response stays chat", () => {
  assert.equal(
    contentItems({ key: "s", role: "assistant", complete: true, text: "你好" })
      .length,
    0,
  );
  assert.equal(
    contentItems({
      key: "s",
      role: "assistant",
      complete: true,
      text: "内容".repeat(600),
    })[0].kind,
    "report",
  );
});
test("only explicit image/video references become media; unrelated links stay Markdown", () => {
  const contents = contentItems({
    key: "s",
    role: "assistant",
    complete: true,
    text: "![画面](https://cdn.test/a.webp)\n[影片](https://cdn.test/a.mp4)\n[官网](https://example.test/)",
  });
  assert.deepEqual(
    contents[0].media.map((c) => c.kind),
    ["image", "video"],
  );
});
test("unsafe schemes, credential URLs and cross-origin plain HTTP are not media", () => {
  const contents = contentItems(
    {
      key: "s",
      role: "assistant",
      complete: true,
      text: "![a](javascript:alert)\n![b](file:///etc/passwd)\n![c](http://other.test/a.png)\n![d](https://user:password@cdn.test/a.png)\n![e](/voice/assets/a.webp)",
    },
    "http://127.0.0.1:26311/voice/",
  );
  assert.equal(contents.length, 1);
  assert.equal(contents[0].url, "http://127.0.0.1:26311/voice/assets/a.webp");
});
test("duplicate media URLs are one card and user text never turns into a result", () => {
  const item = {
    key: "s",
    role: "assistant",
    complete: true,
    text: "![a](https://cdn.test/a.png) ![b](https://cdn.test/a.png)",
  };
  assert.equal(contentItems(item).length, 1);
  assert.deepEqual(contentItems({ ...item, role: "user" }), []);
});
test("media-only backend completion opens the media rather than a wrapper report", () => {
  const item = {
    key: "asset",
    role: "assistant",
    complete: true,
    document: true,
    text: "![图](https://cdn.test/a.webp)",
  };
  assert.deepEqual(
    contentItems(item).map((c) => c.kind),
    ["image"],
  );
  assert.equal(
    contentItems({ ...item, text: "# 方案\n\n介绍\n" + item.text })[0].kind,
    "report",
  );
});

test("mixed Markdown is one result with exact prose and ordered media", () => {
  const text = "# 赛车作品\n\n先看图片。\n\n![图](https://cdn.test/a.webp)\n\n然后是动画。\n\n[视频](https://cdn.test/a.mp4)\n\n[来源](https://example.test/)";
  const result = contentItems({key:"mixed",role:"assistant",complete:true,document:true,text});
  assert.equal(result.length,1);
  assert.equal(result[0].text,text);
  assert.equal(result[0].title,"赛车作品");
  assert.deepEqual(result[0].media.map(m=>m.kind),["image","video"]);
});
test("multiple media without prose still share one result", () => {
  const result = contentItems({key:"gallery",role:"assistant",complete:true,text:"![图](https://cdn.test/a.webp)\n![图二](https://cdn.test/b.webp)"});
  assert.equal(result.length,1); assert.equal(result[0].media.length,2);
});


test('plain attachment URLs become one deliverable without exposing unsafe or duplicate references',()=>{
 const text='已生成小赛车。\n链接：https://cdn.test/a.jpg\nhttps://cdn.test/a.jpg\n视频 https://cdn.test/a.mp4。\nhttps://user:secret@cdn.test/private.png\nhttp://other.test/a.png';
 const result=contentItems({key:'plain',role:'assistant',complete:true,text});
 assert.equal(result.length,1);assert.equal(result[0].text,text);
 assert.deepEqual(result[0].media.map(m=>m.url),['https://cdn.test/a.jpg','https://cdn.test/a.mp4']);
});
