import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const sources = [
  ["client/src/pages/ChefResourcesPage_en.tsx", "en-CA", "chef", "Chef resources"],
  ["client/src/pages/ChefResourcesPage_fr.tsx", "fr-CA", "chef", "Ressources pour chefs"],
  ["client/src/pages/ChefResourcesPage_uk.tsx", "uk", "chef", "Ресурси для кухарів"],
  ["client/src/pages/KitchenResourcesPage_en.tsx", "en-CA", "manager", "Kitchen resources"],
  ["client/src/pages/KitchenResourcesPage_fr.tsx", "fr-CA", "manager", "Ressources pour cuisines"],
  ["client/src/pages/KitchenResourcesPage_uk.tsx", "uk", "manager", "Ресурси для кухонь"],
];

function tagName(element) {
  const opening = element.openingElement;
  return opening.tagName.getText();
}

function idAttribute(element) {
  const attribute = element.openingElement.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === "id",
  );
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function directHeadingText(element) {
  return element.children
    .filter(ts.isJsxText)
    .map((child) => child.text)
    .join(" ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function textBetween(sourceFile, start, end) {
  const pieces = [];
  function visit(node, inExpression = false) {
    if (node.end <= start || node.pos >= end) return;
    if (ts.isJsxText(node)) {
      pieces.push(node.text);
      return;
    }
    if (inExpression && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      pieces.push(node.text);
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) visit(node.expression, true);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, inExpression));
  }
  visit(sourceFile);
  return pieces
    .join(" ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const documents = [];
for (const [relativePath, locale, audience, collection] of sources) {
  const absolutePath = resolve(root, relativePath);
  const sourceText = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const headings = [];
  function findHeadings(node) {
    if (ts.isJsxElement(node) && ["SectionHeading", "SubHeading"].includes(tagName(node))) {
      const id = idAttribute(node);
      const title = directHeadingText(node);
      if (id && title) headings.push({ id, title, position: node.pos, start: node.end });
    }
    ts.forEachChild(node, findHeadings);
  }
  findHeadings(sourceFile);
  headings.sort((a, b) => a.start - b.start);
  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.position ?? sourceFile.end;
    const body = textBetween(sourceFile, heading.start, end);
    if (!body) return;
    documents.push({
      id: `${audience}:${locale}:${heading.id}`,
      locale,
      audience,
      collection,
      anchor: heading.id,
      title: heading.title,
      body,
    });
  });
}

writeFileSync(
  resolve(root, "shared/search-content.generated.json"),
  `${JSON.stringify(documents)}\n`,
);
console.log(`Indexed ${documents.length} anchored resource sections.`);
