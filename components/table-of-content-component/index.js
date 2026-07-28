import "./table-of-content-model.js";
import "./table-of-content.js";

const { TableOfContent, TableOfContentModel } = globalThis;

if (!TableOfContent || !TableOfContentModel) {
  throw new Error(
    "Table of Content is browser-only and requires Custom Elements and Shadow DOM.",
  );
}

export { TableOfContent, TableOfContentModel };
export default TableOfContent;
